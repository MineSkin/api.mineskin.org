import { Document, Model } from "mongoose";
import { Maybe } from "../../util";

export interface IStatDocument extends Document {
    key: string;
    value: number;
}

export interface IStatModel extends Model<IStatDocument> {
    inc(key: string, amount?: number): Promise<void>;

    get(key: string): Promise<Maybe<number>>;

    set(key: string, value: number): Promise<void>;
}

