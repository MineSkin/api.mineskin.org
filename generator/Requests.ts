import { JobQueue } from "jobqu";
import axios, { AxiosRequestConfig, AxiosResponse, AxiosInstance } from "axios";
import { Time } from "@inventivetalent/loading-cache";
import { metrics } from "../util";
import { Config } from "../types/Config";
import { URL } from "url";

const config: Config = require("../config");

axios.defaults.headers["User-Agent"] = "MineSkin";
axios.defaults.headers["Content-Type"] = "application/json";
axios.defaults.timeout = 20000;

export const REQUESTS_METRIC = metrics.metric('mineskin', 'requests');

export class Requests {

    protected static readonly axiosInstance: AxiosInstance = axios.create({});
    protected static readonly mojangAuthInstance: AxiosInstance = axios.create({
        baseURL: "https://authserver.mojang.com",
        headers: {
            "Accept": "application/json, text/plain, */*",
            "Accept-Encoding": "gzip, deflate",
            "Origin": "mojang://launcher",
            "User-Agent": "Minecraft Launcher/2.1.2481 (bcb98e4a63) Windows (10.0; x86_64)"
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

    protected static readonly mojangAuthRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>(request => Requests.runAxiosRequest(request, Requests.mojangAuthInstance), Time.seconds(4));
    protected static readonly mojangApiRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>(request => Requests.runAxiosRequest(request, Requests.mojangApiInstance), Time.seconds(1));
    protected static readonly mojangSessionRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>(request => Requests.runAxiosRequest(request, Requests.mojangSessionInstance), Time.seconds(1));
    protected static readonly minecraftServicesRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>(request => Requests.runAxiosRequest(request, Requests.minecraftServicesInstance), Time.seconds(1.2));

    protected static runAxiosRequest(request: AxiosRequestConfig, instance = this.axiosInstance): Promise<AxiosResponse> {
        return instance.request(request)
            .then(response => {
                const m = REQUESTS_METRIC
                    .tag("server", config.server);
                if (request) {
                    const url = new URL(axios.getUri(request));
                    m.tag("method", request.method || "GET")
                        .tag("endpoint", url.host + "" + url.pathname)
                }
                if (response) {
                    m.tag("statusCode", "" + response.status)
                }
                return response;
            })
    }

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

    public static isOk(response: AxiosResponse): boolean {
        return response.status >= 200 && response.status < 230;
    }

    public static end() {
        this.mojangAuthRequestQueue.end();
        this.mojangApiRequestQueue.end();
        this.mojangSessionRequestQueue.end();
        this.minecraftServicesRequestQueue.end();
    }

}
