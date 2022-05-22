import { model, Schema } from "mongoose";
import { IQueueDocument, IQueueModel } from "../../typings/db/IQueueDocument";

const QueueSchema: Schema<IQueueDocument, IQueueModel> = new Schema(
    {
        type: {
            type: String,
            enum: ["url", "upload"],
            index: true
        },
        state: {
            type: String,
            enum: ["pending", "processing", "complete", "errored"],
            index: true
        },
        server: {
            type: String
        },
        time: {
            type: Date,
            index: true,
            expires: 86400 // 24h
        }
    },
    {
        collection: "queue"
    });

/// METHODS


/// STATICS


export const Queue: IQueueModel = model<IQueueDocument, IQueueModel>("Queue", QueueSchema);
