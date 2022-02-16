import { JobQueue } from "jobqu";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import rateLimit, { RateLimitedAxiosInstance } from "axios-rate-limit";
import { Time } from "@inventivetalent/time";
import { URL } from "url";
import { setInterval } from "timers";
import { IPoint } from "influx";
import * as Sentry from "@sentry/node";
import { getConfig, MineSkinConfig } from "../typings/Configs";
import { MineSkinMetrics } from "../util/metrics";
import { Transaction } from "@sentry/tracing";
import { c } from "../util/colors";
import { Maybe } from "../util";

axios.defaults.headers["User-Agent"] = "MineSkin";
axios.defaults.headers["Content-Type"] = "application/json";
axios.defaults.headers["Accept"] = "application/json";
axios.defaults.timeout = 10000;


export class Requests {

    protected static readonly defaultRateLimit: { maxRequests?: number, perMilliseconds?: number, maxRPS?:number } = {
        maxRequests: 600,
        perMilliseconds: 10 * 60 * 1000
    }

    static readonly axiosInstance: AxiosInstance = axios.create({});
    protected static readonly mojangAuthInstance: AxiosInstance = axios.create({
        baseURL: "https://authserver.mojang.com",
        headers: {
            // "Accept": "application/json, text/plain, */*",
            // "Accept-Encoding": "gzip, deflate",
            // "Origin": "mojang://launcher",
            // "User-Agent": "Minecraft Launcher/2.1.2481 (bcb98e4a63) Windows (10.0; x86_64)"
        }
    });
    protected static readonly mojangApiInstance: AxiosInstance = rateLimit(axios.create({
        baseURL: "https://api.mojang.com",
        headers: {}
    }), Requests.defaultRateLimit);
    protected static readonly mojangApiProfileInstance: AxiosInstance = rateLimit(axios.create({
        baseURL: "https://api.mojang.com",
        headers: {}
    }), {
        maxRequests: 6,
        perMilliseconds: 10 * 1000
    });
    protected static readonly mojangSessionInstance: AxiosInstance = rateLimit(axios.create({
        baseURL: "https://sessionserver.mojang.com",
        headers: {}
    }), Requests.defaultRateLimit);
    protected static readonly minecraftServicesInstance: AxiosInstance = rateLimit(axios.create({
        baseURL: "https://api.minecraftservices.com",
        headers: {}
    }), Requests.defaultRateLimit);
    protected static readonly minecraftServicesProfileInstance: RateLimitedAxiosInstance = rateLimit(axios.create({
        baseURL: "https://api.minecraftservices.com",
        headers: {}
    }), {
        maxRequests: 8,
        perMilliseconds: 30 * 1000
    })
    protected static readonly liveLoginInstance: AxiosInstance = axios.create({
        baseURL: "https://login.live.com",
        headers: {}
    });

    protected static readonly mojangAuthRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, Requests.mojangAuthInstance), Time.millis(200), 1);
    protected static readonly mojangApiRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, Requests.mojangApiInstance), Time.millis(200), 1);
    protected static readonly mojangApiProfileRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, Requests.mojangApiProfileInstance), Time.millis(200), 1);
    protected static readonly mojangSessionRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, Requests.mojangSessionInstance), Time.millis(200), 1);
    protected static readonly minecraftServicesRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, Requests.minecraftServicesInstance), Time.millis(200), 1);
    protected static readonly minecraftServicesProfileRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, Requests.minecraftServicesProfileInstance), Time.millis(200), 1);
    protected static readonly liveLoginRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, Requests.liveLoginInstance), Time.millis(200), 1);

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
        for (let instance of [
            this.axiosInstance,
            this.mojangAuthInstance,
            this.mojangApiInstance,
            this.mojangApiProfileInstance,
            this.mojangSessionInstance,
            this.minecraftServicesInstance,
            this.minecraftServicesProfileInstance,
            this.liveLoginInstance
        ]) {
            instance.defaults.headers["User-Agent"] = "MineSkin/" + config.server;
        }
    }

    protected static async runAxiosRequest(request: AxiosRequestConfig, instance = this.axiosInstance): Promise<AxiosResponse> {
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
                m.tag("method", request.method || "GET")
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

interface ISize {
    size: number;
}
