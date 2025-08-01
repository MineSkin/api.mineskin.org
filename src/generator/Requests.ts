import { JobQueue } from "jobqu";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import rateLimit, { RateLimitedAxiosInstance, rateLimitOptions } from "@inventivetalent/axios-rate-limit";
import { HttpsProxyAgent, HttpsProxyAgentOptions } from "https-proxy-agent"
import { Time } from "@inventivetalent/time";
import { URL } from "url";
import { setInterval } from "timers";
import { IPoint } from "influx";
import * as Sentry from "@sentry/node";
import { Span } from "@sentry/node";
import { getConfig, MineSkinConfig } from "../typings/Configs";
import { MineSkinMetrics } from "../util/metrics";
import { c, debug, warn } from "../util/colors";
import { Maybe, timeout } from "../util";
import * as https from "https";
import { networkInterfaces } from "os";
import { requestShutdown } from "../index";
import { IAccountDocument } from "@mineskin/database";
import { container } from "../inversify.config";
import { IMetricsProvider } from "@mineskin/core";
import { TYPES as CoreTypes } from "@mineskin/core/dist/ditypes";
import { HOSTNAME } from "../util/host";
import axiosRetry from "axios-retry";
import { TEXTURE_DOWNLOAD } from "@mineskin/generator/dist/GeneratorRequests";

export const GENERIC = "generic";
export const IMAGE_FETCH = "imageFetch";
export const MOJANG_AUTH = "mojangAuth";
export const MOJANG_API = "mojangApi";
export const MOJANG_SESSION = "mojangSession";
export const MINECRAFT_SERVICES = "minecraftServices";
export const MINECRAFT_SERVICES_PROFILE = "minecraftServicesProfile";
export const LIVE_LOGIN = "liveLogin";

const MAX_QUEUE_SIZE = 100;
const TIMEOUT = 10000;

axios.defaults.headers["User-Agent"] = "MineSkin";
axios.defaults.headers["Content-Type"] = "application/json";
axios.defaults.headers["Accept"] = "application/json";
axios.defaults.timeout = TIMEOUT;

let SERVER = "???";
let PROXIES: string[] = [];//TODO
let PROXY_INDEX: { [k: string]: number } = {};

export class Requests {

    protected static readonly defaultRateLimit: rateLimitOptions = {
        maxRequests: 600,
        perMilliseconds: 10 * 60 * 1000
    }

    private static readonly axiosInstances: { [k: string]: { [sk: string]: AxiosInstance }; } = {};


    static readonly axiosInstance: AxiosInstance = axios.create({});

    private static readonly requestQueues: {
        [k: string]: { [sk: string]: JobQueue<AxiosRequestConfig, AxiosResponse> };
    } = {};

    protected static metricsCollector = setInterval(async () => {
        const config = await getConfig();
        const points: IPoint[] = [];
        for (let key in Requests.requestQueues) {
            for (let skey in Requests.requestQueues[key]) {
                let queue = Requests.requestQueues[key][skey];
                points.push({
                    measurement: "queues",
                    tags: {
                        queue: key,
                        proxy: skey,
                        server: config.server
                    },
                    fields: {
                        size: queue.size
                    }
                });
            }
        }
        for (let key in Requests.axiosInstances) {
            for (let skey in Requests.axiosInstances[key]) {
                let instance = Requests.axiosInstances[key][skey];
                if (!isRateLimitedAxiosInstance(instance)) continue;
                points.push({
                    measurement: "request_ratelimiters",
                    tags: {
                        limiter: key,
                        proxy: skey,
                        server: config.server
                    },
                    fields: {
                        size: instance.getSize() || 0
                    }
                });
            }
        }
        try {
            const metrics = container.get<MineSkinMetrics>(CoreTypes.MetricsProvider);
            return metrics.getMetrics().influx.writePoints(points, {
                precision: 's'
            });
        } catch (e) {
            console.error(e);
            Sentry.captureException(e);
            console.error("influx error, restarting");
            requestShutdown('INFLUX_ERROR', 1);
        }
    }, 5000);

    public static init(config: MineSkinConfig) {
        console.log(debug("Initializing Requests"));

        SERVER = config.server;
        PROXIES = [config.server];
        if (config.server in config.requestServers) {
            PROXIES = config.requestServers[config.server];
        }
        axios.defaults.headers["User-Agent"] = "MineSkin/" + config.server;

        this.setupMultiProxiedAxiosInstance(GENERIC, config, {});
        this.setupMultiProxiedAxiosInstance(IMAGE_FETCH, config, {}, c => {
            const instance = axios.create(c);
            axiosRetry(instance, {
                retries: 2,
                retryDelay: axiosRetry.exponentialDelay
            });
            return instance;
        });
        this.setupMultiRequestQueue(GENERIC, config, Time.millis(100), 1);
        this.setupMultiRequestQueue(IMAGE_FETCH, config, Time.millis(100), 1);

         this.setupMultiProxiedAxiosInstance(TEXTURE_DOWNLOAD, config, {}, c => {
            const instance = axios.create(c);
            axiosRetry(instance, {
                retries: 2,
                retryDelay: axiosRetry.exponentialDelay
            });
            return instance;
        });
        this.setupMultiRequestQueue(TEXTURE_DOWNLOAD, config, Time.millis(100), 1);


        this.setupMultiProxiedAxiosInstance(MOJANG_AUTH, config, {
            baseURL: "https://authserver.mojang.com"
        });
        this.setupMultiRequestQueue(MOJANG_AUTH, config, Time.millis(200), 1);

        this.setupMultiProxiedAxiosInstance(MOJANG_SESSION, config, {
            baseURL: "https://sessionserver.mojang.com",
            headers: {}
        }, c => rateLimit(axios.create(c), Requests.defaultRateLimit));
        this.setupMultiRequestQueue(MOJANG_SESSION, config, Time.millis(300), 1);

        this.setupMultiProxiedAxiosInstance(MINECRAFT_SERVICES, config, {
            baseURL: "https://api.minecraftservices.com",
            headers: {}
        }, c => rateLimit(axios.create(c), Requests.defaultRateLimit));
        this.setupMultiRequestQueue(MINECRAFT_SERVICES, config, Time.millis(200), 1);

        this.setupMultiProxiedAxiosInstance(MINECRAFT_SERVICES_PROFILE, config, {
            baseURL: "https://api.minecraftservices.com",
            headers: {}
        }, c => rateLimit(axios.create(c), {
            maxRequests: 8,
            perMilliseconds: 30 * 1000
        }));
        this.setupMultiRequestQueue(MINECRAFT_SERVICES_PROFILE, config, Time.millis(200), 1);

        this.setupMultiProxiedAxiosInstance(LIVE_LOGIN, config, {
            baseURL: "https://login.live.com",
            headers: {}
        });
        this.setupMultiRequestQueue(LIVE_LOGIN, config, Time.millis(200), 1);

        setTimeout(() => {
            for (let k in this.axiosInstances) {
                const x = this.axiosInstances[k];
                for (let sk in x) {
                    const instance = x[sk];
                    instance.request({
                        url: "/",
                        timeout: 5000
                    }).then(() => {
                        console.log(debug("axios instance " + k + "/" + sk + " is ready"));
                    }).catch(err => {
                        if (err.response) {
                            console.log(debug("axios instance " + k + "/" + sk + " is probably ready"));
                            console.log(debug(err.message));
                            return;
                        }
                        console.warn(warn("axios instance " + k + "/" + sk + " is not ready"));
                        Sentry.captureException(err, {
                            level: 'warning',
                            tags: {
                                server: config.server,
                                proxy: sk
                            }
                        });
                    })
                }
            }

            this.genericRequest({
                url: 'https://api.ipify.org?format=json',
                method: 'GET'
            }).then(response => {
                console.log(debug("Public IP 4: " + response.data.ip));
            });
            this.genericRequest({
                url: 'https://api6.ipify.org?format=json',
                method: 'GET',
            }).then(response => {
                console.log(debug("Public IP 6: " + response.data.ip));
            });
        }, 100)
    }

    private static setupAxiosInstance(key: string, subkey: string, config: AxiosRequestConfig, constr: AxiosConstructor = (c) => axios.create(c)): void {
        if (!(key in this.axiosInstances)) {
            this.axiosInstances[key] = {};
        }
        this.axiosInstances[key][subkey] = constr(config);
        console.log(debug("set up axios instance " + key + "/" + subkey));
    }

    private static setupProxiedAxiosInstance(key: string, subkey: string, proxyConfig: HttpsProxyAgentOptions, requestConfig: AxiosRequestConfig, constr?: AxiosConstructor): void {
        proxyConfig.headers = Object.assign({}, {
            "MineSkin-Server": SERVER
        }, proxyConfig.headers);
        requestConfig.httpsAgent = new HttpsProxyAgent(proxyConfig);
        if (!requestConfig.headers) {
            requestConfig.headers = {};
        }
        requestConfig.headers["User-Agent"] = "MineSkin/" + SERVER + "/" + subkey;
        this.setupAxiosInstance(key, subkey, requestConfig, constr);
    }

    private static setupIPProxyAxiosInstance(key: string, subkey: string, bindIp: string, requestConfig: AxiosRequestConfig, constr?: AxiosConstructor): void {
        requestConfig.httpsAgent = new https.Agent({
            localAddress: bindIp,
            family: bindIp.includes(":") ? 6 : 4
        })
        if (!requestConfig.headers) {
            requestConfig.headers = {};
        }
        requestConfig.headers["User-Agent"] = "MineSkin/" + SERVER + "/" + subkey;
        this.setupAxiosInstance(key, subkey, requestConfig, constr);
    }

    private static setupMultiProxiedAxiosInstance(key: string, mineskinConfig: MineSkinConfig, requestConfig: AxiosRequestConfig, constr?: AxiosConstructor): void {
        this.setupAxiosInstance(key, SERVER, requestConfig); // default instance without a proxy

        if (!mineskinConfig.proxies.enabled) return;
        const proxyConfig = mineskinConfig.proxies;
        for (let proxyKey in proxyConfig.available) {
            if (!mineskinConfig.requestServers[mineskinConfig.server]?.includes(proxyKey)) continue;
            let proxy = proxyConfig.available[proxyKey];
            if (!proxy.enabled) continue;
            let proxyType = proxy["type"];

            if (proxyType === "ip" && "ip" in proxy) {
                let ip = proxy["ip"]!!;
                if ("auto6" === ip) {
                    console.log(debug("Looking for local IPv6 address for " + proxyKey));
                    const interfaces = networkInterfaces();
                    for (let id in interfaces) {
                        for (let i of interfaces[id]!!) {
                            if (i.family === "IPv6" && !i.internal) {
                                ip = i.address;
                                console.log(debug("Found IPv6 address " + ip + " for " + proxyKey));
                                break;
                            }
                        }
                        if (ip !== proxy["ip"]) {
                            break;
                        }
                    }
                }
                this.setupIPProxyAxiosInstance(key, proxyKey, ip, requestConfig, constr);
            } else {
                this.setupProxiedAxiosInstance(key, proxyKey, proxy, requestConfig, constr);
            }
        }
    }

    private static getAxiosInstance(key: string, subkey: string): AxiosInstance {
        if (key in this.axiosInstances) {
            if (subkey && subkey in this.axiosInstances[key]) {
                return this.axiosInstances[key][subkey];
            }
        }
        console.warn(warn("could not find axios instance " + key + "/" + subkey));
        return this.axiosInstances[key][SERVER]; // fallback to default
    }

    private static getAxiosInstanceForRequest(key: string, request: AxiosRequestConfig): AxiosInstance {
        const subkey = this.getInstanceSubkey(request);
        return this.getAxiosInstance(key, subkey);
    }


    private static setupRequestQueue(key: string, subkey: string, interval: number, maxPerRun: number): void {
        if (!(key in this.requestQueues)) {
            this.requestQueues[key] = {};
        }
        this.requestQueues[key][subkey] = new JobQueue<AxiosRequestConfig, AxiosResponse>(request => {
            const crumbs = this.getBreadcrumb(request);
            return timeout(this.runAxiosRequest(request, key), TIMEOUT, `rq_${ key }_${ subkey }_${ crumbs }`);
        }, interval, maxPerRun);
        console.log(debug("set up request queue " + key + "/" + subkey));
    }

    private static setupMultiRequestQueue(key: string, mineskinConfig: MineSkinConfig, interval: number, maxPerRun: number): void {
        this.setupRequestQueue(key, SERVER, interval, maxPerRun); // default instance without a proxy

        if (!mineskinConfig.proxies.enabled) return;
        const proxyConfig = mineskinConfig.proxies;
        for (let proxyKey in proxyConfig.available) {
            if (!mineskinConfig.requestServers[mineskinConfig.server]?.includes(proxyKey)) continue;
            let proxy = proxyConfig.available[proxyKey];
            if (!proxy.enabled) continue;

            this.setupRequestQueue(key, proxyKey, interval, maxPerRun);
        }
    }

    private static getRequestQueue(key: string, subkey: string): JobQueue<AxiosRequestConfig, AxiosResponse> {
        if (key in this.requestQueues) {
            if (subkey && subkey in this.requestQueues[key]) {
                return this.requestQueues[key][subkey];
            }
        }
        console.warn(warn("could not find request queue " + key + "/" + subkey));
        return this.requestQueues[key][SERVER]; // fallback to default
    }

    private static getRequestQueueForRequest(key: string, request: AxiosRequestConfig): JobQueue<AxiosRequestConfig, AxiosResponse> {
        const subkey = this.getInstanceSubkey(request);
        return this.getRequestQueue(key, subkey);
    }


    private static getInstanceSubkey(request: AxiosRequestConfig): string {
        if (!request.headers) return SERVER;
        return request.headers["mineskin-request-proxy"] || SERVER;
    }

    static putInstanceSubkey(request: AxiosRequestConfig, subkey: string): void {
        if (!request.headers) request.headers = {};
        request.headers["mineskin-request-proxy"] = subkey;
    }

    static putInstanceSubkeyForAccount(request: AxiosRequestConfig, account: IAccountDocument): void {
        this.putInstanceSubkey(request, account.requestServer || SERVER);
    }

    protected static async runAxiosRequest(request: AxiosRequestConfig, inst: AxiosInstance | string = this.axiosInstance): Promise<AxiosResponse> {
        let instanceSubkey: string;
        let instance: AxiosInstance;
        if (typeof inst === "string") {
            instanceSubkey = this.getInstanceSubkey(request);
            instance = this.getAxiosInstance(inst, instanceSubkey);
        } else {
            instance = inst as AxiosInstance;
        }

        const r = await this.trackSentryStart(request, async span => {
            console.log(c.gray(`${ this.getBreadcrumb(request) || '00000000' } ${ request.method || 'GET' } ${ request.baseURL || instance.defaults.baseURL || '' }${ request.url } ${ instanceSubkey ? 'via ' + instanceSubkey : '' }`))
            return await instance.request(request)
                .then(async (response) => this.processRequestMetric(response, request, response, instance))
                .catch(err => this.processRequestMetric(err, request, err.response, instance, err));
        });

        return r;
    }

    static async processRequestMetric<T>(responseOrError: T, request?: AxiosRequestConfig, response?: AxiosResponse, instance?: AxiosInstance, err?: any): Promise<T> {
        const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
        try {
            const m = metrics.getMetric('requests')
                .tag("server", HOSTNAME)
                .tag("hasRequest", `${ typeof request !== "undefined" }`)
                .tag("hasResponse", `${ typeof response !== "undefined" }`);
            if (request) {
                const url = new URL(axios.getUri(request), instance?.defaults.baseURL || request.baseURL);
                m.tag("proxy", this.getInstanceSubkey(request))
                    .tag("method", request.method || "GET")
                    .tag("host", url.hostname.replace(/[0-9]/g, 'x'));

                if (["api.minecraftservices.com", "api.mojang.com", "authserver.mojang.com", "sessionserver.mojang.com"].includes(url.hostname)) {
                    let endpoint = url.pathname;
                    endpoint = endpoint.replace(url.hostname, ''); // for some reason it sometimes includes the hostname
                    if (url.hostname === "sessionserver.mojang.com") {
                        if (endpoint.includes("/session/minecraft/profile")) {
                            let unsigned = endpoint.includes("?unsigned=false")
                            endpoint = "/session/minecraft/profile/xxx";
                            if (unsigned) {
                                endpoint += "?unsigned=false";
                            }
                        }
                    }
                    if (url.hostname === "api.mojang.com") {
                        if (endpoint.includes("/user/profiles") && endpoint.endsWith("/names")) {
                            endpoint = "/user/profiles/xxx/names";
                        }
                        if (endpoint.includes("/users/profiles/minecraft")) {
                            endpoint = "/users/profiles/minecraft/xxx";
                        }
                    }
                    m.tag("endpoint", endpoint);
                }
            }
            if (response) {
                m.tag("statusCode", "" + response.status)

                if (![2, 3].includes(Math.floor(response.status / 100))) {
                    if (request) {
                        console.log(c.yellow(`${ this.getBreadcrumb(request) || '00000000' }   ${ response.status } ${ request.method || 'GET' } ${ request.baseURL || instance?.defaults?.baseURL || '' }${ request.url }`))
                        if (response.data) {
                            console.log(response.data);
                        }
                    }
                }
            }
            if (err) {
                m.tag("error", err.name);
            }
            m.inc();
        } catch (e) {
            Sentry.captureException(e);
        }
        if (err) {
            Sentry.captureException(err, {
                level: 'error',
                tags: {
                    server: HOSTNAME,
                    proxy: request ? this.getInstanceSubkey(request) : "unknown",
                    method: request?.method || "GET"
                }
            });
            throw err;
        }
        return responseOrError;
    }

    private static addBreadcrumb(request: AxiosRequestConfig, bread?: string) {
        if (bread) {
            if (!request.headers) request.headers = {};
            request.headers["mineskin-breadcrumb"] = bread;
        }
    }

    private static getBreadcrumb(request: AxiosRequestConfig): Maybe<string> {
        const h = request.headers?.["mineskin-breadcrumb"];
        if (h) {
            delete request.headers?.["mineskin-breadcrumb"];
            return h;
        }
        return undefined;
    }

    /// API REQUESTS

    public static async dynamicRequest(type: string, request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        this.addBreadcrumb(request, bread);
        return await this.trackSentryQueued(request, async span => {
            const q = this.getRequestQueueForRequest(type, request);
            if (q.size > MAX_QUEUE_SIZE) {
                console.warn(warn(`Rejecting new request as queue for ${ type } is full (${ q.size })! `))
                throw new Error("Request queue is full!");
            }
            return await timeout(q.add(request), TIMEOUT, `rq_dyn_${ type }_${ this.getInstanceSubkey(request) }_${ bread }`);
        });
    }

    public static async dynamicRequestWithAccount(type: string, request: AxiosRequestConfig, account: IAccountDocument, bread?: string): Promise<AxiosResponse> {
        this.putInstanceSubkeyForAccount(request, account);
        return this.dynamicRequest(type, request, bread);
    }

    public static async dynamicRequestWithRandomProxy(type: string, request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        let i = PROXY_INDEX[type] || 0;
        if (i >= PROXIES.length) {
            i = 0;
        }
        this.putInstanceSubkey(request, PROXIES[i]);
        PROXY_INDEX[type] = i + 1;
        return this.dynamicRequest(type, request, bread);
    }

    public static async genericRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        this.addBreadcrumb(request, bread);
        return await this.trackSentryQueued(request, async span => {
            return await this.runAxiosRequest(request, this.axiosInstance);
        });
    }

    public static async mojangAuthRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        return this.dynamicRequest(MOJANG_AUTH, request, bread);
    }

    public static async mojangSessionRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        return this.dynamicRequest(MOJANG_SESSION, request, bread);
    }

    public static async minecraftServicesRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        return this.dynamicRequest(MINECRAFT_SERVICES, request, bread);
    }

    public static async minecraftServicesProfileRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        return this.dynamicRequest(MINECRAFT_SERVICES_PROFILE, request, bread);
    }

    public static async liveLoginRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        return this.dynamicRequest(LIVE_LOGIN, request, bread);
    }

    private static trackSentryQueued<T>(request: AxiosRequestConfig, callback: (span: Span) => T): T {
        return Sentry.startSpan({
            op: "request_queued",
            name: `${ request.method || "GET" } ${ request.url }`,
            attributes: {
                server: SERVER,
                proxy: this.getInstanceSubkey(request)
            }
        }, span => {
            if (span) {
                if (!request.headers) request.headers = {};
                request.headers["mineskin-sentry-transaction"] = span;
            }
            return callback(span);
        });
    }

    private static trackSentryStart<T>(request: AxiosRequestConfig, callback: (span: Span) => T): T {
        return Sentry.withActiveSpan(request.headers?.["mineskin-sentry-transaction"] as Span, () => {
            return Sentry.startSpan({
                op: "request_start",
                name: `${ request.method || "GET" } ${ request.url }`,
                attributes: {
                    server: SERVER,
                    proxy: this.getInstanceSubkey(request)
                }
            }, span => {
                const r = callback(span);
                delete request.headers?.["xmineskin-sentry-transaction"];
                return r;
            });
        })
    }

    /// UTIL

    public static isOk(response: AxiosResponse): boolean {
        return response.status >= 200 && response.status < 230;
    }

    public static end() {

        clearInterval(this.metricsCollector);
    }

}

type AxiosConstructor = (config: AxiosRequestConfig) => AxiosInstance;

function isRateLimitedAxiosInstance(obj: any): obj is RateLimitedAxiosInstance {
    return "setRateLimitOptions" in obj;
}
