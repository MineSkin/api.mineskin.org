import { Request } from "express";
import { Breadcrumb, ClientInfo } from "@mineskin/types";
import { IApiKeyDocument } from "@mineskin/database";

export interface MineSkinV2Request extends Request{
    breadcrumb?: Breadcrumb;

    _apiKeyStr?: string;
    apiKeyId?: string;
    apiKeyRef?: string; // short id + name
    apiKey?: IApiKeyDocument;

    client?: ClientInfo;
}

export type GenerateV2Request = MineSkinV2Request;
