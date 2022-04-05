import { Document, Model } from "mongoose";
import { Maybe } from "../../util";

export interface IStatDocument extends Document {
    key: string;
    value: number;
    expire?: Date;
}

export interface IStatModel extends Model<IStatDocument> {
    inc(key: string, amount?: number): Promise<void>;

    incWithExpiration(key: string, expire: Date, amount?: number): Promise<void>;

    get(key: string): Promise<Maybe<number>>;

    set(key: string, value: number): Promise<void>;

    setWithExpiration(key: string, value: number, expire: Date): Promise<void>;
}

