import { Document } from "mongoose";

export interface IStatDocument extends Document {
    key: string;
    value: number;
}
