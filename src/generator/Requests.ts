import { JobQueue } from "jobqu";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import rateLimit, { rateLimitOptions } from "@inventivetalent/axios-rate-limit";
import { HttpsProxyAgent, HttpsProxyAgentOptions } from "https-proxy-agent"
import { Time } from "@inventivetalent/time";
import { URL } from "url";
import { setInterval } from "timers";
import { IPoint } from "influx";
import * as Sentry from "@sentry/node";
import { getConfig, MineSkinConfig } from "../typings/Configs";
import { MineSkinMetrics } from "../util/metrics";
import { Transaction } from "@sentry/tracing";
import { c, debug, warn } from "../util/colors";
import { Maybe } from "../util";
import { IAccountDocument } from "../typings";

export const GENERIC = "generic";
export const MOJANG_AUTH = "mojangAuth";
export const MOJANG_API = "mojangApi";
export const MOJANG_API_PROFILE = "mojangApiProfile";
export const MOJANG_SESSION = "mojangSession";
export const MINECRAFT_SERVICES = "minecraftServices";
export const MINECRAFT_SERVICES_PROFILE = "minecraftServicesProfile";
export const LIVE_LOGIN = "liveLogin";

axios.defaults.headers["User-Agent"] = "MineSkin";
axios.defaults.headers["Content-Type"] = "application/json";
axios.defaults.headers["Accept"] = "application/json";
axios.defaults.timeout = 10000;

let SERVER = "???";

export class Requests {

    protected static readonly defaultRateLimit: rateLimitOptions = {
        maxRequests: 600,
        perMilliseconds: 10 * 60 * 1000
    }

    private static readonly axiosInstances: { [k: string]: { [sk: string]: AxiosInstance }; } = {};


    static readonly axiosInstance: AxiosInstance = axios.create({});

    private static readonly requestQueues: { [k: string]: { [sk: string]: JobQueue<AxiosRequestConfig, AxiosResponse> }; } = {};

    // protected static readonly mojangAuthInstance: AxiosInstance = axios.create({
    //     baseURL: "https://authserver.mojang.com",
    //     headers: {
    //         // "Accept": "application/json, text/plain, */*",
    //         // "Accept-Encoding": "gzip, deflate",
    //         // "Origin": "mojang://launcher",
    //         // "User-Agent": "Minecraft Launcher/2.1.2481 (bcb98e4a63) Windows (10.0; x86_64)"
    //     }
    // });
    // protected static readonly mojangApiInstance: AxiosInstance = rateLimit(axios.create({
    //     baseURL: "https://api.mojang.com",
    //     headers: {}
    // }), Requests.defaultRateLimit);
    // protected static readonly mojangApiProfileInstance: AxiosInstance = rateLimit(axios.create({
    //     baseURL: "https://api.mojang.com",
    //     headers: {},
    //     httpsAgent: new HttpsProxyAgent({})
    // }), {
    //     maxRequests: 600,
    //     perMilliseconds: 10 * 60 * 1000
    // });
    // protected static readonly mojangSessionInstance: AxiosInstance = rateLimit(axios.create({
    //     baseURL: "https://sessionserver.mojang.com",
    //     headers: {}
    // }), Requests.defaultRateLimit);
    // protected static readonly minecraftServicesInstance: AxiosInstance = rateLimit(axios.create({
    //     baseURL: "https://api.minecraftservices.com",
    //     headers: {}
    // }), Requests.defaultRateLimit);
    // protected static readonly minecraftServicesProfileInstance: RateLimitedAxiosInstance = rateLimit(axios.create({
    //     baseURL: "https://api.minecraftservices.com",
    //     headers: {}
    // }), {
    //     maxRequests: 8,
    //     perMilliseconds: 30 * 1000
    // })
    // protected static readonly liveLoginInstance: AxiosInstance = axios.create({
    //     baseURL: "https://login.live.com",
    //     headers: {}
    // });

    // protected static readonly mojangAuthRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
    //     = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, MOJANG_AUTH), Time.millis(200), 1);
    // protected static readonly mojangApiRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
    //     = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, MOJANG_API), Time.millis(200), 1);
    // protected static readonly mojangApiProfileRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
    //     = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, MOJANG_API_PROFILE), Time.millis(400), 1);
    // protected static readonly mojangSessionRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
    //     = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, MOJANG_SESSION), Time.millis(200), 1);
    // protected static readonly minecraftServicesRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
    //     = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, MINECRAFT_SERVICES), Time.millis(200), 1);
    // protected static readonly minecraftServicesProfileRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
    //     = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, MINECRAFT_SERVICES_PROFILE), Time.millis(200), 1);
    // protected static readonly liveLoginRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
    //     = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, LIVE_LOGIN), Time.millis(200), 1);

    // protected static readonly minecraftServicesProfileRequestThrottle: Throttle<AxiosRequestConfig, AxiosResponse>
    //     = new Throttle<AxiosRequestConfig, AxiosResponse>(Time.seconds(3), request => Requests.runAxiosRequest(request, Requests.minecraftServicesInstance)); // 2s is too fast already...

    protected static metricsCollector = setInterval(async () => {
        const config = await getConfig();
        // const queues = new Map<string, ISize>([
        //     ["mojangAuth", Requests.mojangAuthRequestQueue],
        //     ["mojangApi", Requests.mojangApiRequestQueue],
        //     ["mojangApiProfile", Requests.mojangApiProfileRequestQueue],
        //     ["mojangSession", Requests.mojangSessionRequestQueue],
        //     ["minecraftServices", Requests.minecraftServicesRequestQueue],
        //     ["minecraftServicesProfile", Requests.minecraftServicesProfileRequestQueue],
        //     ["liveLogin", Requests.liveLoginRequestQueue]
        // ]);
        const points: IPoint[] = [];
        for (let key in Requests.requestQueues) {
            for (let skey in Requests.requestQueues[key]) {
                let queue = Requests.requestQueues[key][skey];
                points.push({
                    measurement: "queues",
                    tags: {
                        queue: key,
                        instance: skey,
                        server: config.server
                    },
                    fields: {
                        size: queue.size
                    }
                });
            }
        }
        // queues.forEach((queue, name) => {
        //     points.push({
        //         measurement: "queues",
        //         tags: {
        //             queue: name,
        //             server: config.server
        //         },
        //         fields: {
        //             size: queue.size
        //         }
        //     });
        // });
        try {
            MineSkinMetrics.get().then(metrics => {
                metrics.metrics!.influx.writePoints(points, {
                    precision: 's'
                });
            })
        } catch (e) {
            Sentry.captureException(e);
        }
    }, 10000);

    public static init(config: MineSkinConfig) {
        SERVER = config.server;
        axios.defaults.headers["User-Agent"] = "MineSkin/" + config.server;

        this.setupMultiProxiedAxiosInstance(GENERIC, config, {});

        this.setupMultiProxiedAxiosInstance(MOJANG_AUTH, config, {
            baseURL: "https://authserver.mojang.com"
        });
        this.setupMultiRequestQueue(MOJANG_AUTH, config, Time.millis(200), 1);

        this.setupMultiProxiedAxiosInstance(MOJANG_API, config, {
            baseURL: "https://api.mojang.com",
            headers: {}
        }, c => rateLimit(axios.create(c), Requests.defaultRateLimit));
        this.setupMultiRequestQueue(MOJANG_API, config, Time.millis(200), 1);

        this.setupMultiProxiedAxiosInstance(MOJANG_API_PROFILE, config, {
            baseURL: "https://api.mojang.com",
            headers: {}
        }, c => rateLimit(axios.create(c), {
            maxRequests: 600,
            perMilliseconds: 10 * 60 * 1000
        }));
        this.setupMultiRequestQueue(MOJANG_API_PROFILE, config, Time.millis(400), 1);

        this.setupMultiProxiedAxiosInstance(MOJANG_SESSION, config, {
            baseURL: "https://sessionserver.mojang.com",
            headers: {}
        }, c => rateLimit(axios.create(c), Requests.defaultRateLimit));
        this.setupMultiRequestQueue(MOJANG_SESSION, config, Time.millis(200), 1);

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
        this.setupMultiRequestQueue(MINECRAFT_SERVICES_PROFILE, config, Time.millis(200), 1);
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
            "X-MineSkin-Server": SERVER
        }, proxyConfig.headers);
        requestConfig.httpsAgent = new HttpsProxyAgent(proxyConfig);
        if (!requestConfig.headers) {
            requestConfig.headers = {};
        }
        requestConfig.headers["User-Agent"] = "MineSkin/" + SERVER + "/" + subkey;
        this.setupAxiosInstance(key, subkey, requestConfig, constr);
    }

    private static setupMultiProxiedAxiosInstance(key: string, mineskinConfig: MineSkinConfig, requestConfig: AxiosRequestConfig, constr?: AxiosConstructor): void {
        this.setupAxiosInstance(key, "default", requestConfig); // default instance without a proxy

        if (!mineskinConfig.proxies.enabled) return;
        const proxyConfig = mineskinConfig.proxies;
        for (let proxyKey in proxyConfig.available) {
            let proxy = proxyConfig.available[proxyKey];
            if (!proxy.enabled) continue;
            let proxyType = proxy["type"]; //TODO

            this.setupProxiedAxiosInstance(key, proxyKey, proxy, requestConfig, constr);
        }
    }

    private static getAxiosInstance(key: string, subkey: string): AxiosInstance {
        if (key in this.axiosInstances) {
            if (subkey && subkey in this.axiosInstances[key]) {
                return this.axiosInstances[key][subkey];
            }
        }
        console.warn(warn("could not find axios instance " + key + "/" + subkey));
        return this.axiosInstances[key]["default"]; // fallback to default
    }

    private static getAxiosInstanceForRequest(key: string, request: AxiosRequestConfig): AxiosInstance {
        const subkey = this.getInstanceSubkey(request);
        return this.getAxiosInstance(key, subkey);
    }


    private static setupRequestQueue(key: string, subkey: string, interval: number, maxPerRun: number): void {
        if (!(key in this.requestQueues)) {
            this.requestQueues[key] = {};
        }
        this.requestQueues[key][subkey] = new JobQueue<AxiosRequestConfig, AxiosResponse>(request => this.runAxiosRequest(request, key), interval, maxPerRun);
        console.log(debug("set up request queue " + key + "/" + subkey));
    }

    private static setupMultiRequestQueue(key: string, mineskinConfig: MineSkinConfig, interval: number, maxPerRun: number): void {
        this.setupRequestQueue(key, "default", interval, maxPerRun); // default instance without a proxy

        if (!mineskinConfig.proxies.enabled) return;
        const proxyConfig = mineskinConfig.proxies;
        for (let proxyKey in proxyConfig.available) {
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
        return this.requestQueues[key]["default"]; // fallback to default
    }

    private static getRequestQueueForRequest(key: string, request: AxiosRequestConfig): JobQueue<AxiosRequestConfig, AxiosResponse> {
        const subkey = this.getInstanceSubkey(request);
        return this.getRequestQueue(key, subkey);
    }


    private static getInstanceSubkey(request: AxiosRequestConfig): string {
        if (!request.headers) return "default";
        return request.headers["x-mineskin-request-proxy"] || "default";
    }

    static putInstanceSubkey(request: AxiosRequestConfig, subkey: string): void {
        request.headers["x-mineskin-request-proxy"] = subkey;
    }

    static putInstanceSubkeyForAccount(request: AxiosRequestConfig, account: IAccountDocument): void {
        if (account.requestProxy && account.requestProxy.length > 0) {
            this.putInstanceSubkey(request, account.requestProxy);
        }
    }


    protected static async runAxiosRequest(request: AxiosRequestConfig, inst: AxiosInstance | string = this.axiosInstance): Promise<AxiosResponse> {
        let instanceSubkey;
        let instance: AxiosInstance;
        if (typeof inst === "string") {
            instanceSubkey = this.getInstanceSubkey(request);
            instance = this.getAxiosInstance(inst, instanceSubkey);
        } else {
            instance = inst as AxiosInstance;
        }

        const t = this.trackSentryStart(request);
        console.log(c.gray(`${ this.getBreadcrumb(request) || '00000000' } ${ request.method || 'GET' } ${ request.baseURL || instance.defaults.baseURL || '' }${ request.url } ${instanceSubkey ? 'via ' + instanceSubkey : ''}`))
        const r = await instance.request(request)
            .then(async (response) => this.processRequestMetric(response, request, response, instance))
            .catch(err => this.processRequestMetric(err, request, err.response, instance, err));
        t?.finish();
        return r;
    }

    static async processRequestMetric<T>(responseOrError: T, request?: AxiosRequestConfig, response?: AxiosResponse, instance?: AxiosInstance, err?: any): Promise<T> {
        const metrics = await MineSkinMetrics.get();
        try {
            const m = metrics.requests
                .tag("server", metrics.config.server)
                .tag("hasRequest", `${ typeof request !== "undefined" }`)
                .tag("hasResponse", `${ typeof response !== "undefined" }`);
            if (request) {
                const url = new URL(axios.getUri(request), instance?.defaults.baseURL);
                m.tag("proxy", this.getInstanceSubkey(request))
                    .tag("method", request.method || "GET")
                    .tag("host", url.hostname);

                if (["api.minecraftservices.com", "api.mojang.com", "authserver.mojang.com", "sessionserver.mojang.com"].includes(url.hostname)) {
                    let endpoint = url.pathname;
                    if (url.hostname === "sessionserver.mojang.com") {
                        if (endpoint.startsWith("/session/minecraft/profile")) {
                            endpoint = "/session/minecraft/profile/xxx";
                        }
                    }
                    if (url.hostname === "api.mojang.com") {
                        if (endpoint.startsWith("/user/profiles") && endpoint.endsWith("/names")) {
                            endpoint = "/user/profiles/xxx/names";
                        }
                        if (endpoint.startsWith("/users/profiles/minecraft")) {
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
            throw err;
        }
        return responseOrError;
    }

    private static addBreadcrumb(request: AxiosRequestConfig, bread?: string) {
        if (bread) {
            if (!request.headers) request.headers = {};
            request.headers["x-mineskin-breadcrumb"] = bread;
        }
    }

    private static getBreadcrumb(request: AxiosRequestConfig): Maybe<string> {
        const h = request.headers["x-mineskin-breadcrumb"];
        if (h) {
            delete request.headers["x-mineskin-breadcrumb"];
            return h;
        }
        return undefined;
    }

    /// API REQUESTS

    public static async dynamicRequest(type: string, request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        this.addBreadcrumb(request, bread);
        const t = this.trackSentryQueued(request);
        const q = this.getRequestQueueForRequest(type, request);
        const r = await q.add(request);
        t?.finish();
        return r;
    }

    public static async dynamicRequestWithAccount(type: string, request: AxiosRequestConfig, account: IAccountDocument, bread?: string): Promise<AxiosResponse> {
        this.putInstanceSubkeyForAccount(request, account);
        return this.dynamicRequest(type, request, bread);
    }

    public static async genericRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        this.addBreadcrumb(request, bread);
        const t = this.trackSentryQueued(request);
        const r = await this.runAxiosRequest(request, this.axiosInstance);
        t?.finish();
        return r;
    }

    public static async mojangAuthRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        return this.dynamicRequest(MOJANG_AUTH, request, bread);
        // this.addBreadcrumb(request, bread);
        // const t = this.trackSentryQueued(request);
        // const r = await this.mojangAuthRequestQueue.add(request);
        // t?.finish();
        // return r;
    }

    public static async mojangApiRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        return this.dynamicRequest(MOJANG_API, request, bread);
        // this.addBreadcrumb(request, bread);
        // const t = this.trackSentryQueued(request);
        // const r = await this.mojangApiRequestQueue.add(request);
        // t?.finish();
        // return r;
    }

    public static async mojangApiProfileRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        return this.dynamicRequest(MOJANG_API_PROFILE, request, bread);
        // this.addBreadcrumb(request, bread);
        // const t = this.trackSentryQueued(request);
        // const r = await this.mojangApiProfileRequestQueue.add(request);
        // t?.finish();
        // return r;
    }

    public static async mojangSessionRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        return this.dynamicRequest(MOJANG_SESSION, request, bread);
        // this.addBreadcrumb(request, bread);
        // const t = this.trackSentryQueued(request);
        // const r = await this.mojangSessionRequestQueue.add(request);
        // t?.finish();
        // return r;
    }

    public static async minecraftServicesRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        return this.dynamicRequest(MINECRAFT_SERVICES, request, bread);
        // this.addBreadcrumb(request, bread);
        // const t = this.trackSentryQueued(request);
        // const r = await this.minecraftServicesRequestQueue.add(request);
        // t?.finish();
        // return r;
    }

    public static async minecraftServicesProfileRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        return this.dynamicRequest(MINECRAFT_SERVICES_PROFILE, request, bread);
        // this.addBreadcrumb(request, bread);
        // const t = this.trackSentryQueued(request);
        // const r = await this.minecraftServicesProfileRequestQueue.add(request);
        // // const r = await this.minecraftServicesProfileRequestThrottle.submit(request);
        // t?.finish();
        // return r;
    }

    public static async liveLoginRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        return this.dynamicRequest(LIVE_LOGIN, request, bread);
        // this.addBreadcrumb(request, bread);
        // const t = this.trackSentryQueued(request);
        // const r = await this.liveLoginRequestQueue.add(request);
        // t?.finish();
        // return r;
    }

    private static trackSentryQueued(request: AxiosRequestConfig) {
        const t = Sentry.getCurrentHub().getScope()?.getTransaction();
        const s = t?.startChild({
            op: "request_queued",
            description: `${ request.method || "GET" } ${ request.url }`,
            tags: {
                server: SERVER,
                proxy: this.getInstanceSubkey(request)
            }
        });
        if (t) {
            if (!request.headers) request.headers = {};
            request.headers["x-mineskin-sentry-transaction"] = t;
        }
        return s;
    }

    private static trackSentryStart(request: AxiosRequestConfig) {
        const s = (request.headers["x-mineskin-sentry-transaction"] as Transaction)?.startChild({
            op: "request_start",
            description: `${ request.method || "GET" } ${ request.url }`,
            tags: {
                server: SERVER,
                proxy: this.getInstanceSubkey(request)
            }
        });
        delete request.headers["x-mineskin-sentry-transaction"];
        delete request.headers["x-mineskin-request-proxy"];
        return s;
    }

    /// UTIL

    public static isOk(response: AxiosResponse): boolean {
        return response.status >= 200 && response.status < 230;
    }

    public static end() {
        // this.mojangAuthRequestQueue.end();
        // this.mojangApiRequestQueue.end();
        // this.mojangSessionRequestQueue.end();
        // this.minecraftServicesRequestQueue.end();
        // this.liveLoginRequestQueue.end();

        clearInterval(this.metricsCollector);
    }

}

type AxiosConstructor = (config: AxiosRequestConfig) => AxiosInstance;


interface ISize {
    size: number;
}
