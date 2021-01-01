import { Document, Model } from "mongoose";

export interface ITrafficDocument extends Document {
    ip: string;
    lastRequest: Date;
}

export interface ITrafficModel extends Model<ITrafficDocument> {
    findForIp(ip: string): Promise<ITrafficDocument>;

    updateRequestTime(ip: string, time?: Date): Promise<any>;
}
