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
import { c, warn } from "../util/colors";
import { Maybe } from "../util";

const GENERIC = "generic";
const MOJANG_AUTH = "mojangAuth";
const MOJANG_API = "mojangApi";
const MOJANG_API_PROFILE = "mojangApiProfile";
const MOJANG_SESSION = "mojangSession";
const MINECRAFT_SERVICES = "minecraftServices";
const MINECRAFT_SERVICES_PROFILE = "minecraftServicesProfile";
const LIVE_LOGIN = "liveLogin";

axios.defaults.headers["User-Agent"] = "MineSkin";
axios.defaults.headers["Content-Type"] = "application/json";
axios.defaults.headers["Accept"] = "application/json";
axios.defaults.timeout = 10000;


export class Requests {

    protected static readonly defaultRateLimit: rateLimitOptions = {
        maxRequests: 600,
        perMilliseconds: 10 * 60 * 1000
    }

    private static readonly axiosInstances: { [k: string]: { [sk: string]: AxiosInstance }; } = {};


    static readonly axiosInstance: AxiosInstance = axios.create({});

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

    protected static readonly mojangAuthRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, MOJANG_AUTH), Time.millis(200), 1);
    protected static readonly mojangApiRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, MOJANG_API), Time.millis(200), 1);
    protected static readonly mojangApiProfileRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, MOJANG_API_PROFILE), Time.millis(400), 1);
    protected static readonly mojangSessionRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, MOJANG_SESSION), Time.millis(200), 1);
    protected static readonly minecraftServicesRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, MINECRAFT_SERVICES), Time.millis(200), 1);
    protected static readonly minecraftServicesProfileRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, MINECRAFT_SERVICES_PROFILE), Time.millis(200), 1);
    protected static readonly liveLoginRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, LIVE_LOGIN), Time.millis(200), 1);

    // protected static readonly minecraftServicesProfileRequestThrottle: Throttle<AxiosRequestConfig, AxiosResponse>
    //     = new Throttle<AxiosRequestConfig, AxiosResponse>(Time.seconds(3), request => Requests.runAxiosRequest(request, Requests.minecraftServicesInstance)); // 2s is too fast already...

    protected static metricsCollector = setInterval(async () => {
        const config = await getConfig();
        const queues = new Map<string, ISize>([
            ["mojangAuth", Requests.mojangAuthRequestQueue],
            ["mojangApi", Requests.mojangApiRequestQueue],
            ["mojangApiProfile", Requests.mojangApiProfileRequestQueue],
            ["mojangSession", Requests.mojangSessionRequestQueue],
            ["minecraftServices", Requests.minecraftServicesRequestQueue],
            ["minecraftServicesProfile", Requests.minecraftServicesProfileRequestQueue],
            ["liveLogin", Requests.liveLoginRequestQueue]
        ]);
        const points: IPoint[] = [];
        queues.forEach((queue, name) => {
            points.push({
                measurement: "queues",
                tags: {
                    queue: name,
                    server: config.server
                },
                fields: {
                    size: queue.size
                }
            });
        });
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
        axios.defaults.headers["User-Agent"] = "MineSkin/" + config.server;

        this.setupMultiProxiedAxiosInstance(GENERIC, config, {});
        this.setupMultiProxiedAxiosInstance(MOJANG_AUTH, config, {
            baseURL: "https://authserver.mojang.com"
        });
        this.setupMultiProxiedAxiosInstance(MOJANG_API, config, {
            baseURL: "https://api.mojang.com",
            headers: {}
        }, c => rateLimit(axios.create(c), Requests.defaultRateLimit));
        this.setupMultiProxiedAxiosInstance(MOJANG_API_PROFILE, config, {
            baseURL: "https://api.mojang.com",
            headers: {}
        }, c => rateLimit(axios.create(c), {
            maxRequests: 600,
            perMilliseconds: 10 * 60 * 1000
        }));
        this.setupMultiProxiedAxiosInstance(MOJANG_SESSION, config, {
            baseURL: "https://sessionserver.mojang.com",
            headers: {}
        }, c => rateLimit(axios.create(c), Requests.defaultRateLimit));
        this.setupMultiProxiedAxiosInstance(MINECRAFT_SERVICES, config, {
            baseURL: "https://api.minecraftservices.com",
            headers: {}
        }, c => rateLimit(axios.create(c), Requests.defaultRateLimit));
        this.setupMultiProxiedAxiosInstance(MINECRAFT_SERVICES_PROFILE, config, {
            baseURL: "https://api.minecraftservices.com",
            headers: {}
        }, c => rateLimit(axios.create(c), {
            maxRequests: 8,
            perMilliseconds: 30 * 1000
        }));
        this.setupMultiProxiedAxiosInstance(LIVE_LOGIN, config, {
            baseURL: "https://login.live.com",
            headers: {}
        });
    }

    private static setupAxiosInstance(key: string, subkey: string, config: AxiosRequestConfig, constr: AxiosConstructor = (c) => axios.create(c)): void {
        if (!(key in this.axiosInstances)) {
            this.axiosInstances[key] = {};
        }
        this.axiosInstances[key][subkey] = constr(config);
    }

    private static setupProxiedAxiosInstance(key: string, subkey: string, proxyConfig: HttpsProxyAgentOptions, requestConfig: AxiosRequestConfig, constr?: AxiosConstructor): void {
        requestConfig.httpsAgent = new HttpsProxyAgent(proxyConfig);
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
            delete proxy["enabled"];
            delete proxy["type"];

            this.setupProxiedAxiosInstance(key, proxyKey, proxy, requestConfig, constr);
        }
    }

    private static getAxiosInstance(key: string, subkey: string): Maybe<AxiosInstance> {
        if (key in this.axiosInstances) {
            if (subkey && subkey in this.axiosInstances[key]) {
                return this.axiosInstances[key][subkey];
            }
        }
        console.warn(warn("could not find axios instance " + key + "/" + subkey));
        return this.axiosInstances[key]["default"]; // fallback to default
    }

    private static getAxiosInstanceForRequest(key: string, request: AxiosRequestConfig): Maybe<AxiosInstance> {
        const subkey = this.getInstanceSubkey(request);
        return this.getAxiosInstance(key, subkey);
    }

    private static getInstanceSubkey(request: AxiosRequestConfig): string {
        return request.headers["x-mineskin-request-instance"] || "default";
    }

    static putInstanceSubkey(request: AxiosRequestConfig, subkey: string): void {
        request.headers["x-mineskin-request-instance"] = subkey;
    }

    protected static async runAxiosRequest(request: AxiosRequestConfig, inst: AxiosInstance | string = this.axiosInstance): Promise<AxiosResponse> {
        let instance: AxiosInstance;
        if (typeof inst === "string") {
            instance = this.getAxiosInstanceForRequest(inst, request)!;
        } else {
            instance = inst as AxiosInstance;
        }

        const t = this.trackSentryStart(request);
        console.log(c.gray(`${ this.getBreadcrumb(request) || '00000000' } ${ request.method || 'GET' } ${ request.baseURL || instance.defaults.baseURL || '' }${ request.url }`))
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
                m.tag("instance", this.getInstanceSubkey(request))
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

    public static async genericRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        this.addBreadcrumb(request, bread);
        const t = this.trackSentryQueued(request);
        const r = await this.runAxiosRequest(request, this.axiosInstance);
        t?.finish();
        return r;
    }

    public static async mojangAuthRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        this.addBreadcrumb(request, bread);
        const t = this.trackSentryQueued(request);
        const r = await this.mojangAuthRequestQueue.add(request);
        t?.finish();
        return r;
    }

    public static async mojangApiRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        this.addBreadcrumb(request, bread);
        const t = this.trackSentryQueued(request);
        const r = await this.mojangApiRequestQueue.add(request);
        t?.finish();
        return r;
    }

    public static async mojangApiProfileRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        this.addBreadcrumb(request, bread);
        const t = this.trackSentryQueued(request);
        const r = await this.mojangApiProfileRequestQueue.add(request);
        t?.finish();
        return r;
    }

    public static async mojangSessionRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        this.addBreadcrumb(request, bread);
        const t = this.trackSentryQueued(request);
        const r = await this.mojangSessionRequestQueue.add(request);
        t?.finish();
        return r;
    }

    public static async minecraftServicesRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        this.addBreadcrumb(request, bread);
        const t = this.trackSentryQueued(request);
        const r = await this.minecraftServicesRequestQueue.add(request);
        t?.finish();
        return r;
    }

    public static async minecraftServicesProfileRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        this.addBreadcrumb(request, bread);
        const t = this.trackSentryQueued(request);
        const r = await this.minecraftServicesProfileRequestQueue.add(request);
        // const r = await this.minecraftServicesProfileRequestThrottle.submit(request);
        t?.finish();
        return r;
    }

    public static async liveLoginRequest(request: AxiosRequestConfig, bread?: string): Promise<AxiosResponse> {
        this.addBreadcrumb(request, bread);
        const t = this.trackSentryQueued(request);
        const r = await this.liveLoginRequestQueue.add(request);
        t?.finish();
        return r;
    }

    private static trackSentryQueued(request: AxiosRequestConfig) {
        const t = Sentry.getCurrentHub().getScope()?.getTransaction();
        const s = t?.startChild({
            op: "request_queued",
            description: `${ request.method || "GET" } ${ request.url }`
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
        });
        delete request.headers["x-mineskin-sentry-transaction"];
        return s;
    }

    /// UTIL

    public static isOk(response: AxiosResponse): boolean {
        return response.status >= 200 && response.status < 230;
    }

    public static end() {
        this.mojangAuthRequestQueue.end();
        this.mojangApiRequestQueue.end();
        this.mojangSessionRequestQueue.end();
        this.minecraftServicesRequestQueue.end();
        this.liveLoginRequestQueue.end();

        clearInterval(this.metricsCollector);
    }

}

type AxiosConstructor = (config: AxiosRequestConfig) => AxiosInstance;


interface ISize {
    size: number;
}
