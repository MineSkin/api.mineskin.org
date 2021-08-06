import { Document, Model } from "mongoose";
import { Maybe } from "../../util";

export interface IApiKeyDocument extends Document {
    name: string;
    owner: string;
    key: string;
    secret: string;
    createdAt: Date;
    updatedAt?: Date;
    minDelay?: number;
    allowedOrigins?: string[];
    allowedIps?: string[];
    allowedAgents?: string[];

    getMinDelay(): Promise<number>;
}

export interface IApiKeyModel extends Model<IApiKeyDocument> {
    findKey(key: string): Promise<Maybe<IApiKeyDocument>>;
}

