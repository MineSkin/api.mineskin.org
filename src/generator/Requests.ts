import { JobQueue } from "jobqu";
import axios, { AxiosRequestConfig, AxiosResponse, AxiosInstance } from "axios";
import { Time } from "@inventivetalent/time";
import { URL } from "url";
import { setInterval } from "timers";
import { IPoint } from "influx";
import * as Sentry from "@sentry/node";
import { getConfig } from "../typings/Configs";
import { MineSkinMetrics } from "../util/metrics";

axios.defaults.headers["User-Agent"] = "MineSkin";
axios.defaults.headers["Content-Type"] = "application/json";
axios.defaults.headers["Accept"] = "application/json";
axios.defaults.timeout = 20000;


export class Requests {

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
    protected static readonly mojangApiInstance: AxiosInstance = axios.create({
        baseURL: "https://api.mojang.com",
        headers: {}
    });
    protected static readonly mojangSessionInstance: AxiosInstance = axios.create({
        baseURL: "https://sessionserver.mojang.com",
        headers: {}
    });
    protected static readonly minecraftServicesInstance: AxiosInstance = axios.create({
        baseURL: "https://api.minecraftservices.com",
        headers: {}
    });
    protected static readonly liveLoginInstance: AxiosInstance = axios.create({
        baseURL: "https://login.live.com",
        headers: {}
    });

    protected static readonly mojangAuthRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, Requests.mojangAuthInstance), Time.seconds(2));
    protected static readonly mojangApiRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, Requests.mojangApiInstance), Time.seconds(1));
    protected static readonly mojangSessionRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, Requests.mojangSessionInstance), Time.seconds(1));
    protected static readonly minecraftServicesRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, Requests.minecraftServicesInstance), Time.seconds(1.2));
    protected static readonly liveLoginRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>((request: AxiosRequestConfig) => Requests.runAxiosRequest(request, Requests.liveLoginInstance), Time.seconds(1));

    protected static metricsCollector = setInterval(async () => {
        const config = await getConfig();
        const queues = new Map<string, JobQueue<AxiosRequestConfig, AxiosResponse>>([
            ["mojangAuth", Requests.mojangAuthRequestQueue],
            ["mojangApi", Requests.mojangApiRequestQueue],
            ["mojangSession", Requests.mojangSessionRequestQueue],
            ["minecraftServices", Requests.minecraftServicesRequestQueue],
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
                metrics.metrics!.influx.writePoints(points);
            })
        } catch (e) {
            Sentry.captureException(e);
        }
    }, 10000);

    protected static runAxiosRequest(request: AxiosRequestConfig, instance = this.axiosInstance): Promise<AxiosResponse> {
        return instance.request(request)
            .then(async (response) => this.processRequestMetric(response, request, response, instance))
            .catch(err => this.processRequestMetric(err, request, err.response, instance, err))
    }

    static async processRequestMetric<T>(responseOrError: T, request?: AxiosRequestConfig, response?: AxiosResponse, instance?: AxiosInstance, err?: any): Promise<T> {
        const metrics = await MineSkinMetrics.get();
        try {
            const m = metrics.requests
                .tag("server", metrics.config.server);
            if (request) {
                const url = new URL(axios.getUri(request), instance?.defaults.baseURL);
                m.tag("method", request.method || "GET")
                    .tag("host", url.hostname);
            }
            if (response) {
                m.tag("statusCode", "" + response.status)
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

    /// API REQUESTS

    public static mojangAuthRequest(request: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.mojangAuthRequestQueue.add(request);
    }

    public static mojangApiRequest(request: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.mojangApiRequestQueue.add(request);
    }

    public static mojangSessionRequest(request: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.mojangSessionRequestQueue.add(request);
    }

    public static minecraftServicesRequest(request: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.minecraftServicesRequestQueue.add(request);
    }

    public static liveLoginRequest(request: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.liveLoginRequestQueue.add(request);
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
