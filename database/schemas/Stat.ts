import { Model, model, Schema } from "mongoose";
import { IStatDocument } from "../../types";

const schema: Schema = new Schema(
    {
        key: String,
        value: Number
    },
    {
        collection: "stats"
    });
export const Stat: Model<IStatDocument> = model<IStatDocument>("Stat", schema);
