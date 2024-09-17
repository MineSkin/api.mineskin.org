import { Bread } from "./Bread";
import { Request } from "express";
import { ApiKeyRequest } from "./ApiKeyRequest";
import { DelayInfo } from "./DelayInfo";

export type MineSkinRequest = Request & ApiKeyRequest & {delayInfo?: DelayInfo};
export type BreadRequest = MineSkinRequest & Bread;
export type GenerateRequest = BreadRequest;

export function isBreadRequest(request: Request): request is BreadRequest {
    return (<BreadRequest>request).breadcrumb !== undefined;
}
