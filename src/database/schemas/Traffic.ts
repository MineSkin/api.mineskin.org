import { LeanDocumentOrArray, model, Schema } from "mongoose";
import { ITrafficDocument } from "../../typings";
import { ITrafficModel } from "../../typings/db/ITrafficDocument";

export const schema: Schema<ITrafficDocument, ITrafficModel> = new Schema(
    {
        ip: String,
        lastRequest: {
            type: Date,
            expires: 3600
        }
    },
    {
        collection: "traffic"
    });

schema.statics.findForIp = function (this: ITrafficModel, ip: string): Promise<LeanDocumentOrArray<ITrafficDocument | null>> {
    return this.findOne({ ip: ip }).lean().exec();
};

schema.statics.updateRequestTime = function (this: ITrafficModel, ip: string, time: Date = new Date()): Promise<any> {
    return this.updateOne({ip: ip},{lastRequest: time}, {upsert: true}).exec();
};

export const Traffic: ITrafficModel = model<ITrafficDocument, ITrafficModel>("Traffic", schema);
