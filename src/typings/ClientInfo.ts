import { SimplifiedUserAgent } from "../util";
import { DelayInfo } from "./DelayInfo";
import { UUID } from "@mineskin/types";

export interface ClientInfo {
    time: number;
    userAgent: SimplifiedUserAgent;
    origin?: string;
    ip: string;
    via: string;
    apiKey?: string;
    apiKeyId?: string;
    delayInfo?: DelayInfo;
    nextRequest?: number;

    user?: UUID;
    billable?: boolean;
    metered?: boolean;
    useCredits?: boolean;
}
