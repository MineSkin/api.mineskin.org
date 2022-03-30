import { LeanDocumentOrArray, model, Schema } from "mongoose";
import { ITrafficDocument } from "../../typings";
import { ITrafficModel } from "../../typings/db/ITrafficDocument";

export const TrafficSchema: Schema<ITrafficDocument, ITrafficModel> = new Schema(
    {
        ip: {
            type: String,
            index: true
        },
        lastRequest: {
            type: Date,
            expires: 3600
        }
    },
    {
        collection: "traffic"
    });

TrafficSchema.statics.findForIp = function (this: ITrafficModel, ip: string): Promise<LeanDocumentOrArray<ITrafficDocument | null>> {
    return this.findOne({ ip: ip }).lean().exec();
};

TrafficSchema.statics.updateRequestTime = function (this: ITrafficModel, ip: string, time: Date = new Date()): Promise<any> {
    return this.updateOne({ip: ip},{lastRequest: time}, {upsert: true, maxTimeMS: 5000}).exec();
};

export const Traffic: ITrafficModel = model<ITrafficDocument, ITrafficModel>("Traffic", TrafficSchema);
