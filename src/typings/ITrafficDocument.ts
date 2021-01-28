import { Document, Model } from "mongoose";
import { Maybe } from "../util";

export interface ITrafficDocument extends Document {
    ip: string;
    lastRequest: Date;
}

export interface ITrafficModel extends Model<ITrafficDocument> {
    findForIp(ip: string): Promise<Maybe<ITrafficDocument>>;

    updateRequestTime(ip: string, time?: Date): Promise<any>;
}
