import { Request } from "express";
import { Breadcrumb, ClientInfo } from "@mineskin/types";
import { IApiKeyDocument } from "@mineskin/database";
import { Chalk } from "chalk";
import { CodeAndMessage } from "../../typings/v2/CodeAndMessage";
import { RequestClient } from "@mineskin/generator";

export interface MineSkinV2Request extends Request {
    breadcrumb?: Breadcrumb;
    breadcrumbColor?: Chalk;
    breadcrumbC?: string;

    _apiKeyStr?: string;
    apiKeyId?: string;
    apiKeyShortId?: string;
    apiKeyRef?: string; // short id + name
    apiKey?: IApiKeyDocument;

    clientInfo?: ClientInfo;
    client: RequestClient;

    messages: CodeAndMessage[];
    warnings: CodeAndMessage[];
    links: {
        [key: string]: string;
    }
}

export interface GenerateV2Request extends MineSkinV2Request {
    /** in milliseconds **/
    minDelay?: number;
    /** in milliseconds **/
    nextRequest?: number;

    requestsThisMinute?: number;
    maxPerMinute?: number;
    /** in seconds**/
    maxPerMinuteReset?: number;

    maxConcurrent?: number;
    concurrentRequests?: number;

    file?: Express.Multer.File;
    body: {
        url?: string;
        user?: string;
    }
}
