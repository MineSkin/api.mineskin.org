import { IRequestExecutor } from "@mineskin/core";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { injectable } from "inversify";
import { Requests } from "./generator/Requests";

//TODO: properly implement this
@injectable()
export class WrappedRequestExecutor implements IRequestExecutor {

    constructor() {
    }

    dynamicRequest<K extends unknown>(key: K, request: AxiosRequestConfig, breadcrumb?: string): Promise<AxiosResponse> {
        return Requests.dynamicRequest(key as string, request, breadcrumb);
    }
}