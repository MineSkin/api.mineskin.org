import { SimplifiedUserAgent } from "../util";

export interface ClientInfo {
    userAgent: SimplifiedUserAgent;
    origin?: string;
    ip: string;
    via: string;
    apiKey?: string;
    apiKeyId?: string;
}
