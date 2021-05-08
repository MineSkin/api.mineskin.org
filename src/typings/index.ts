import { Bread } from "./Bread";
import { Request } from "express";

export { IAccountDocument } from "./db/IAccountDocument";
export { ISkinDocument } from "./db/ISkinDocument";
export { ITrafficDocument } from "./db/ITrafficDocument";
export { IStatDocument } from "./db/IStatDocument";

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

export type MineSkinRequest = Request;
export type BreadRequest = MineSkinRequest & Bread;
export type GenerateRequest = BreadRequest;

export function isBreadRequest(request: Request): request is BreadRequest {
    return (<BreadRequest>request).breadcrumb !== undefined;
}
