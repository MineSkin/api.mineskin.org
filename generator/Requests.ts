import { JobQueue } from "jobqu";
import axios, { AxiosRequestConfig, AxiosResponse, AxiosInstance } from "axios";
import { Time } from "@inventivetalent/loading-cache";

export class Requests {

    protected static readonly axiosInstance: AxiosInstance = axios.create({});
    protected static readonly mojangAuthInstance: AxiosInstance = axios.create({
        baseURL: "https://authserver.mojang.com"
    });
    protected static readonly mojangApiInstance: AxiosInstance = axios.create({
        baseURL: "https://api.mojang.com"
    });
    protected static readonly mojangSessionInstance: AxiosInstance = axios.create({
        baseURL: "https://sessionserver.mojang.com"
    });
    protected static readonly minecraftServicesInstance: AxiosInstance = axios.create({
        baseURL: "https://api.minecraftservices.com"
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
        //TODO: metrics
        return instance.request(request);
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

    public static end() {
        this.mojangAuthRequestQueue.end();
        this.mojangApiRequestQueue.end();
        this.mojangSessionRequestQueue.end();
        this.minecraftServicesRequestQueue.end();
    }

}
