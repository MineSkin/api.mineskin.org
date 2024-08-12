import { Document, Model } from "mongoose";
import { Maybe } from "../../util";

export interface IApiKeyDocument extends Document {
    name: string;
    owner?: string; // deprecated
    user?: string;
    key: string;
    secret: string;
    createdAt: Date;
    updatedAt?: Date;
    lastUsed?: Date;
    minDelay?: number;
    billable?: boolean;
    allowedOrigins?: string[];
    allowedIps?: string[];
    allowedAgents?: string[];

    getMinDelay(): Promise<number>;

    updateLastUsed(date: Date): Promise<void>;
}

export interface IApiKeyModel extends Model<IApiKeyDocument> {
    findKey(key: string): Promise<Maybe<IApiKeyDocument>>;
}
