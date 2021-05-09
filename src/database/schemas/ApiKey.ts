import { Model, model, Schema } from "mongoose";
import { Maybe } from "../../util";
import { IStatDocument, IStatModel } from "../../typings/db/IStatDocument";
import { IApiKeyDocument, IApiKeyModel } from "../../typings/db/IApiKeyDocument";
import { ISkinDocument } from "../../typings";
import { Skin, SkinSchema } from "./Skin";

const schema: Schema<IApiKeyDocument, IApiKeyModel> = new Schema(
    {
        name: {
            type: String,
            required: true
        },
        owner: {
            type: String,
            required: true
        },
        key: {
            type: String,
            required: true,
            index: true
        },
        secret: {
            type: String,
            required: true
        },
        createdAt: {
            type: Date,
            required: true
        },
        updatedAt: {
            type: Date
        },
        allowedOrigins: [String],
        allowedIps: [String],
        allowedAgents: [String],
        minDelay: Number
    },
    {
        collection: "apikeys"
    });


/// STATICS

schema.statics.findKey = function (key: string): Promise<IApiKeyDocument | null> {
    return ApiKey.findOne({ key: key }).exec();
};

export const ApiKey: IApiKeyModel = model<IApiKeyDocument, IApiKeyModel>("ApiKey", schema);
