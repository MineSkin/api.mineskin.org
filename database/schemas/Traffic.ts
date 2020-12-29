import { Model, model, Schema } from "mongoose";
import { ITraffic } from "../../types";

const schema: Schema = new Schema(
    {
        ip: String,
        lastRequest: {
            type: Date,
            expires: 3600
        }
    },
    {
        collection: "traffic"
    })
export const Traffic: Model<ITraffic> = model<ITraffic>("Traffic", schema);
