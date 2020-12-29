import { Model, model, Schema } from "mongoose";
import { IAccount } from "../../types";

const Int32 = require("mongoose-int32");
const schema: Schema = new Schema({
    id: {
        type: Number,
        index: true
    },
    username: {
        type: String,
        index: true
    },
    uuid: {
        type: String,
        index: true
    },
    playername: String,
    authInterceptorEnabled: Boolean,
    password: String,
    passwordOld: String,
    passwordNew: String,
    security: String,
    multiSecurity: [{
        id: Number,
        answer: String
    }],
    microsoftAccount: Boolean,
    microsoftUserId: {
        type: String,
        index: true
    },
    microsoftRefreshToken: String,
    minecraftXboxUsername: {
        type: String,
        index: true
    },
    lastSelected: Number,
    timeAdded: {
        type: Number,
        index: true
    },
    lastUsed: {
        type: Number,
        index: true
    },
    enabled: {
        type: Boolean,
        index: true
    },
    errorCounter: Int32,
    successCounter: Int32,
    totalErrorCounter: Number,
    totalSuccessCounter: Number,
    lastErrorCode: String,
    forcedTimeoutAt: Number,
    lastTextureUrl: String,
    sameTextureCounter: Number,
    accessToken: String,
    accessTokenExpiration: Number,
    accessTokenSource: String,
    clientToken: String,
    requestIp: String,
    requestServer: {
        type: String,
        index: true
    },
    lastRequestServer: {
        type: String
    },
    type: {
        type: String,
        enum: ["internal", "external"],
        default: "internal"
    },
    discordUser: String,
    discordMessageSent: Boolean,
    sendEmails: Boolean
}, { id: false });
export const Account: Model<IAccount> = model<IAccount>("Account", schema);
