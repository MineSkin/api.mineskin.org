import { Document, Model } from "mongoose";

export interface IQueueDocument extends Document {
    name: string;
    owner?: string; // deprecated
    user?: string;
    key: string;
    secret: string;
    createdAt: Date;
    updatedAt?: Date;
    lastUsed?: Date;
    minDelay?: number;
    allowedOrigins?: string[];
    allowedIps?: string[];
    allowedAgents?: string[];
}

export interface IQueueModel extends Model<IQueueDocument> {
}
