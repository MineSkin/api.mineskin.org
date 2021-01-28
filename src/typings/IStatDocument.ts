import { Document, Model } from "mongoose";
import { ITrafficDocument } from "./ITrafficDocument";

export interface IStatDocument extends Document {
    key: string;
    value: number;
}

export interface IStatModel extends Model<IStatDocument> {
    inc(key: string, amount?: number): Promise<void>;
}

