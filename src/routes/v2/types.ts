import { Request } from "express";
import { Breadcrumb, ClientInfo, UUID } from "@mineskin/types";
import { IApiKeyDocument } from "@mineskin/database";
import { Chalk } from "chalk";
import { CodeAndMessage } from "../../typings/v2/CodeAndMessage";

export interface MineSkinV2Request extends Request {
    breadcrumb?: Breadcrumb;
    breadcrumbColor?: Chalk;
    breadcrumbC?: string;

    _apiKeyStr?: string;
    apiKeyId?: string;
    apiKeyRef?: string; // short id + name
    apiKey?: IApiKeyDocument;

    client?: ClientInfo;

    user?: {
        uuid: UUID;
        billable?: boolean;
        grants?: Record<string, string | number | boolean>;
    }

    grants?: Record<string, string | number | boolean>;

    messages: CodeAndMessage[];
    warnings: CodeAndMessage[];
    links: {
        [key: string]: string;
    }
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
