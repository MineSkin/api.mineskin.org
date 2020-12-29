import { Document } from "mongoose";

export interface IStat extends Document {
    key: string;
    value: number;
}
