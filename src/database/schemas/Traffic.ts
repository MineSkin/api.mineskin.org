import { model, Schema } from "mongoose";
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

TrafficSchema.statics.findForIp = async function (this: ITrafficModel, ip: string): Promise<ITrafficDocument[] | null> {
    return (await this.findOne({ip: ip}, null, {
        sort: {lastRequest: -1}
    }).lean().exec()) as ITrafficDocument[] | null;
};

TrafficSchema.statics.findForKey = async function (this: ITrafficModel, key: string): Promise<ITrafficDocument[] | null> {
    return (await this.findOne({key: key}, null, {
        sort: {lastRequest: -1}
    }).lean().exec()) as ITrafficDocument[] | null;
}

TrafficSchema.statics.updateRequestTime = function (this: ITrafficModel, ip: string, key: string | null, time: Date = new Date()): Promise<any> {
    return this.updateOne({
        ip: ip,
        key: {
            $exists: key !== null,
            $eq: key || undefined
        }
    }, {
        lastRequest: time,
        $inc: {count: 1}
    }, {upsert: true, maxTimeMS: 5000}).exec();
};

export const Traffic: ITrafficModel = model<ITrafficDocument, ITrafficModel>("Traffic", TrafficSchema);
