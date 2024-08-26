import { SimplifiedUserAgent } from "../util";
import { DelayInfo } from "./DelayInfo";

export interface ClientInfo {
    time: number;
    userAgent: SimplifiedUserAgent;
    origin?: string;
    ip: string;
    via: string;
    apiKey?: string;
    apiKeyId?: string;
    delayInfo?: DelayInfo;
}

export type ClientInfoPartial = Pick<ClientInfo,'ip'|'apiKeyId'|'time'>;