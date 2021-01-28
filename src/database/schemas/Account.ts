import { Model, model, Schema } from "mongoose";
import { md5, Maybe } from "../../util";
import { v4 as uuid } from "uuid";
import { getConfig } from "../../typings/Configs";
import { IAccountDocument } from "../../typings";
import { IAccountModel } from "../../typings/IAccountDocument";
import { debug, error } from "../../util/colors";
import { Bread } from "../../typings/Bread";

const config = getConfig();

const Int32 = require("mongoose-int32");
export const AccountSchema: Schema<IAccountDocument, IAccountModel> = new Schema({
    id: {
        type: Number,
        index: true
    },
    username: {
        type: String,
        index: true
    },
    email: {
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
    accountType: String,
    microsoftAccount: Boolean,
    microsoftUserId: {
        type: String,
        index: true
    },
    microsoftAccessToken: String,
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


/// METHODS

AccountSchema.methods.getOrCreateClientToken = function (this: IAccountDocument): string {
    if (!this.clientToken) {
        this.clientToken = md5(uuid());
    }
    return this.clientToken;
};

AccountSchema.methods.updateRequestServer = function (this: IAccountDocument, newRequestServer?: string) {
    if (this.requestServer && this.requestServer !== newRequestServer) {
        this.lastRequestServer = this.requestServer;
    }
    this.requestServer = newRequestServer;
};

AccountSchema.methods.getEmail = function (this: IAccountDocument): string {
    if (this.email) {
        return this.email;
    } else {
        this.email = this.username;
        return this.username;
    }
};

AccountSchema.methods.authenticationHeader = function (this: IAccountDocument): string {
    return `Bearer ${ this.accessToken }`;
};

AccountSchema.methods.toSimplifiedString = function (this: IAccountDocument): string {
    return `Account{ id=${ this.id }, uuid=${ this.uuid }, type=${ this.microsoftAccount ? 'microsoft' : 'mojang' } }`
};

/// STATICS

AccountSchema.statics.findUsable = function (this: IAccountModel, bread?: Bread): Promise<Maybe<IAccountDocument>> {
    const time = Math.floor(Date.now() / 1000);
    return this.findOne({
        enabled: true,
        requestServer: { $in: [undefined, "default", config.server] },
        lastUsed: { $lt: (time - 100) },
        forcedTimeoutAt: { $lt: (time - 500) },
        errorCounter: { $lt: (config.errorThreshold || 10) },
        timeAdded: { $lt: (time - 60) }
    }).sort({
        lastUsed: 1,
        lastSelected: 1,
        sameTextureCounter: 1
    } as IAccountDocument).exec()
        .then((account: IAccountDocument) => {
            if (!account) {
                console.warn(error(bread?.breadcrumb + " There are no accounts available!"));
                return undefined;
            }
            console.log(debug(bread?.breadcrumb + " Account #" + account.id + " last used " + Math.round(time - (account.lastUsed || 0)) + "s ago, last selected " + Math.round(time - (account.lastSelected || 0)) + "s ago"));
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

AccountSchema.statics.getAccountsPerServer = function (this: IAccountModel): Promise<{ server: string, count: number }[]> {
    return this.aggregate([
        { $match: { enabled: true, errorCounter: { $lt: 10 } } },
        { $group: { _id: '$requestServer', count: { $sum: 1 } } },
        { $sort: { count: 1 } }
    ]).exec().then((accountsPerServer: any[]) => {
        const arr: { server: string, count: number }[] = [];
        if (accountsPerServer && accountsPerServer.length > 0) {
            accountsPerServer.forEach(a => {
                arr.push({
                    server: a["_id"],
                    count: a["count"]
                })
            });
        }
        return arr;
    });
}

AccountSchema.statics.getPreferredAccountServer = function (this: IAccountModel): Promise<Maybe<string>> {
    return this.getAccountsPerServer().then(accountsPerServer => {
        if (!accountsPerServer || accountsPerServer.length < 1) {
            return undefined;
        }
        // sorted from least to most
        return accountsPerServer[0].server;
    })
}

export const Account: IAccountModel = model<IAccountDocument, IAccountModel>("Account", AccountSchema);
