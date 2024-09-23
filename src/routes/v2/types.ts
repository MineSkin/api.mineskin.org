import { Request } from "express";
import { Breadcrumb, ClientInfo } from "@mineskin/types";
import { IApiKeyDocument } from "@mineskin/database";
import { Chalk } from "chalk";

export interface MineSkinV2Request extends Request {
    breadcrumb?: Breadcrumb;
    breadcrumbColor?: Chalk;
    breadcrumbC?: string;

    _apiKeyStr?: string;
    apiKeyId?: string;
    apiKeyRef?: string; // short id + name
    apiKey?: IApiKeyDocument;

    client?: ClientInfo;
}

export interface GenerateV2Request extends MineSkinV2Request {
    minDelay?: number;
    nextRequest?: number;

    file?: Express.Multer.File;
    body: {
        url?: string;
        user?: string;
    }
}
