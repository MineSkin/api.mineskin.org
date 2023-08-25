import {model, Schema} from "mongoose";
import {IApiKeyDocument, IApiKeyModel} from "../../typings/db/IApiKeyDocument";
import {getConfig} from "../../typings/Configs";

const ApiKeySchema: Schema<IApiKeyDocument, IApiKeyModel> = new Schema(
    {
        name: {
            type: String,
            required: true
        },
        owner: { // deprecated
            type: String
        },
        user: {
            type: String,
            index: true
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
        lastUsed: {
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

/// METHODS


ApiKeySchema.methods.getMinDelay = async function (this: IApiKeyDocument): Promise<number> {
    if (this.minDelay) {
        return this.minDelay;
    }
    return (await getConfig()).delays.defaultApiKey;
}

ApiKeySchema.methods.updateLastUsed = async function (this: IApiKeyDocument, date: Date): Promise<void> {
    return ApiKey.updateOne({ key: this.key }, { $set: { lastUsed: date }, $inc: { requestCount: 1 } }).exec().then(ignored => {
    });
}

/// STATICS

ApiKeySchema.statics.findKey = function (key: string): Promise<IApiKeyDocument | null> {
    return ApiKey.findOne({ key: key }).exec();
};

export const ApiKey: IApiKeyModel = model<IApiKeyDocument, IApiKeyModel>("ApiKey", ApiKeySchema);
