import { Model, model, Schema } from "mongoose";
import { IAccountDocument } from "../../types";
import { IAccountModel } from "../../types/IAccountDocument";
import { Config } from "../../types/Config";
import { warn, error } from "../../util";

const config: Config = require("../../config");

const Int32 = require("mongoose-int32");
export const AccountSchema: Schema = new Schema({
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

/// STATICS

AccountSchema.statics.findUsable = function (this: IAccountModel): Promise<IAccountDocument> {
    const time = Math.floor(Date.now() / 1000);
    return this.findOne({
        enabled: true,
        requestServer: { $in: [null, "default", config.server] },
        lastUsed: { $lt: (time - 100) },
        forcedTimeoutAt: { $lt: (time - 500) },
        errorCounter: { $lt: (config.errorThreshold || 10) },
        timeAdded: { $lt: (time - 60) }
    }).sort({
        lastUsed: 1,
        lastSelected: 1,
        sameTextureCounter: 1
    } as IAccountDocument).exec()
        .then(account => {
            if (!account) {
                console.warn(error("There are no accounts available!"));
                return undefined;
            }
            console.log("Account #" + account.id + " last used " + Math.round(time - account.lastUsed) + "s ago, last selected " + Math.round(time - account.lastSelected) + "s ago");
            account.lastUsed = time;
            account.lastSelected = time;
            if (!account.successCounter) account.successCounter = 0;
            if (!account.errorCounter) account.errorCounter = 0;
            if (!account.totalSuccessCounter) account.totalSuccessCounter = 0;
            if (!account.totalErrorCounter) account.totalErrorCounter = 0;
            return account.save();
        })
};

AccountSchema.statics.countGlobalUsable = function (this: IAccountModel): Promise<number> {
    return this.count({
        enabled: true,
        errorCounter: { $lt: (config.errorThreshold || 10) }
    }).exec();
};

AccountSchema.statics.calculateDelay = function (this: IAccountModel): Promise<number> {
    return this.countGlobalUsable().then(usable => {
        if (usable <= 0) {
            console.warn(error("Global usable account count is " + usable));
            return 200;
        }
        return Math.round(config.generateDelay / Math.max(1, usable))
    });
};

export const Account: IAccountModel = model<IAccountDocument, IAccountModel>("Account", AccountSchema);
