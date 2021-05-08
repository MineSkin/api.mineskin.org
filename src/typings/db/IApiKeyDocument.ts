import { Document, Model } from "mongoose";
import { ITrafficDocument } from "./ITrafficDocument";

export interface IApiKeyDocument extends Document {
    name: string;
    owner: string;
    key: string;
    secret: string;
    createdAt: Date;
    minDelay: number;
    allowedOrigins?: string[];
    allowedIps?: string[];
    allowedAgents?: string[];
}

export interface IApiKeyModel extends Model<IApiKeyDocument> {
}

