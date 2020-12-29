import { Model, model, Schema } from "mongoose";
import { IStat } from "../../types";

const schema: Schema = new Schema(
    {
        key: String,
        value: Number
    },
    {
        collection: "stats"
    });
export const Stat: Model<IStat> = model<IStat>("Stat", schema);
