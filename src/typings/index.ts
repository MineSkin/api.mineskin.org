import { Bread } from "./Bread";
import { Request } from "express";
import { ApiKeyRequest } from "./ApiKeyRequest";
import { DelayInfo } from "./DelayInfo";

// https://stackoverflow.com/a/60323233/6257838
export class MineSkinError extends Error {
    constructor(public code: string, public msg?: string, public httpCode?: number) {
        super(msg ? `[${ code }] ${ msg }` : code);
        Object.setPrototypeOf(this, MineSkinError.prototype);
    }

    get name(): string {
        return 'MineSkinError';
    }
}

export type MineSkinRequest = Request & ApiKeyRequest & {delayInfo?: DelayInfo};
export type BreadRequest = MineSkinRequest & Bread;
export type GenerateRequest = BreadRequest;

export function isBreadRequest(request: Request): request is BreadRequest {
    return (<BreadRequest>request).breadcrumb !== undefined;
}
