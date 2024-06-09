import { LeanDocumentOrArray, model, Schema } from "mongoose";
import { ITrafficDocument } from "../../typings";
import { ITrafficModel } from "../../typings/db/ITrafficDocument";

export const TrafficSchema: Schema<ITrafficDocument, ITrafficModel> = new Schema(
    {
        ip: {
            type: String,
            index: true
        },
        key: {
            type: String,
            index: true
        },
        lastRequest: {
            type: Date,
            expires: 3600
        },
        count: {
            type: Number,
            default: 0
        }
    },
    {
        collection: "traffic"
    });

TrafficSchema.statics.findForIp = function (this: ITrafficModel, ip: string): Promise<LeanDocumentOrArray<ITrafficDocument | null>> {
    return this.findOne({ip: ip}, null, {
        sort: {lastRequest: -1}
    }).lean().exec();
};

TrafficSchema.statics.findForKey = function (this: ITrafficModel, key: string): Promise<LeanDocumentOrArray<ITrafficDocument | null>> {
    return this.findOne({key: key}, null, {
        sort: {lastRequest: -1}
    }).lean().exec();
}

TrafficSchema.statics.updateRequestTime = function (this: ITrafficModel, ip: string, key: string | null, time: Date = new Date()): Promise<any> {
    return this.updateOne({
        ip: ip,
        key: key
    }, {
        lastRequest: time,
        $inc: {count: 1}
    }, {upsert: true, maxTimeMS: 5000}).exec();
};

export const Traffic: ITrafficModel = model<ITrafficDocument, ITrafficModel>("Traffic", TrafficSchema);
