import { Document } from "mongoose";

export interface ITraffic extends Document {
    ip: string;
    lastRequest: Date;
}
