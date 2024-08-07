import { Document, Model } from "mongoose";
import { Maybe } from "../../util";

export interface ITrafficDocument extends Document {
    ip: string;
    key: string;
    lastRequest: Date;
    count: number;
}

export interface ITrafficModel extends Model<ITrafficDocument> {
    findForIp(ip: string): Promise<Maybe<ITrafficDocument>>;

    findForKey(key: string): Promise<Maybe<ITrafficDocument>>;

    updateRequestTime(ip: string, key: string | null, time?: Date): Promise<any>;
}
