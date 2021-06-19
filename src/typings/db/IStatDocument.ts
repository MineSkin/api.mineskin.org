import { Document, Model } from "mongoose";

export interface IStatDocument extends Document {
    key: string;
    value: number;
}

export interface IStatModel extends Model<IStatDocument> {
    inc(key: string, amount?: number): Promise<void>;
}

