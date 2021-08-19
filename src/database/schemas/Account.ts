import { model, Schema } from "mongoose";
import { Maybe, md5 } from "../../util";
import { v4 as uuid } from "uuid";
import { getConfig } from "../../typings/Configs";
import { IAccountDocument } from "../../typings";
import { AccountType, IAccountModel } from "../../typings/db/IAccountDocument";
import { debug, error, warn } from "../../util/colors";
import { Bread } from "../../typings/Bread";
import { Caching } from "../../generator/Caching";
import { MineSkinMetrics } from "../../util/metrics";
import * as Sentry from "@sentry/node";
import { MIN_ACCOUNT_DELAY } from "../../generator/Generator";

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
    lastGenerateSuccess: Number,
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
    sendEmails: Boolean,
    emailSent: Boolean,
    ev: Number
}, { id: false });


/// METHODS

AccountSchema.methods.getOrCreateClientToken = function (this: IAccountDocument): string {
    if (!this.clientToken) {
        this.clientToken = md5(uuid());
    }
    return this.clientToken;
};

AccountSchema.methods.updateRequestServer = function (this: IAccountDocument, newRequestServer: string | null) {
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
    }
    return this.email;
};

AccountSchema.methods.getAccountType = function (this: IAccountDocument): AccountType {
    if (this.accountType) {
        return this.accountType;
    }
    if (this.microsoftAccount) {
        this.accountType = AccountType.MICROSOFT;
    } else {
        this.accountType = AccountType.MOJANG;
    }
    return this.accountType;
};

AccountSchema.methods.authenticationHeader = function (this: IAccountDocument): string {
    return `Bearer ${ this.accessToken }`;
};

AccountSchema.methods.toSimplifiedString = function (this: IAccountDocument): string {
    return `Account{ id=${ this.id }, uuid=${ this.uuid }, type=${ this.getAccountType() } }`
};

AccountSchema.methods.getEV = function (this: IAccountDocument): number {
    if (this.ev) {
        return this.ev;
    }
    this.ev = 0;
    return this.ev;
};

/// STATICS

AccountSchema.statics.findUsable = async function (this: IAccountModel, bread?: Bread): Promise<Maybe<IAccountDocument>> {
    const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
    const span = transaction?.startChild({
        op: "account_findUsable"
    })

    const time = Math.floor(Date.now() / 1000);
    const metrics = await MineSkinMetrics.get();
    return this.findOne({
        enabled: true,
        id: { $nin: Caching.getLockedAccounts() },
        $and: [
            {
                $or: [
                    { requestServer: { $exists: false } },
                    { requestServer: { $in: ["default", metrics.config.server] } },
                    { requestServer: null }
                ]
            },
            {
                $or: [
                    { lastSelected: { $exists: false } },
                    { lastSelected: { $lt: (time - 50) } }
                ]
            },
            {
                $or: [
                    { lastUsed: { $exists: false } },
                    { lastUsed: { $lt: (time - 100) } }
                ]
            },
            {
                $or: [
                    { forcedTimeoutAt: { $exists: false } },
                    { forcedTimeoutAt: { $lt: (time - 500) } }
                ]
            }
        ],
        errorCounter: { $lt: (metrics.config.errorThreshold || 10) },
        timeAdded: { $lt: (time - 60) }
    }).sort({
        lastUsed: 1,
        lastSelected: 1,
        sameTextureCounter: 1
    } as IAccountDocument).exec()
        .then((account: IAccountDocument) => {
            if (!account) {
                console.warn(error(bread?.breadcrumb + " There are no accounts available!"));
                span?.setStatus("not_found").finish()
                return undefined;
            }
            if (Caching.isAccountLocked(account.id)) {
                console.warn(warn(bread?.breadcrumb + " Selecting a different account since " + account.id + " got locked since querying"));
                span?.setStatus("not_found").finish();
                return Account.findUsable(bread);
            }
            Caching.lockSelectedAccount(account.id, bread);

            let usedDiff = Math.round(time - (account.lastUsed || 0));
            let selectedDiff = Math.round(time - (account.lastSelected || 0));
            console.log(debug(bread?.breadcrumb + " Account #" + account.id + " last used " + usedDiff + "s ago, last selected " + selectedDiff + "s ago"));
            Sentry.setExtras({
                "used_diff": usedDiff,
                "selected_diff": selectedDiff
            });
            let usedDiffMins = Math.round(usedDiff / 60 / 2) * 2;
            Sentry.setTag("used_diff_mins", `${ usedDiffMins }`);
            try {
                metrics.metrics!.influx.writePoints([{
                    measurement: 'account_selection_difference',
                    tags: {
                        server: metrics.config.server,
                        account: account.id
                    },
                    fields: {
                        lastSelected: selectedDiff,
                        lastUsed: usedDiff
                    }
                }], {
                    database: 'mineskin'
                })
            } catch (e) {
                Sentry.captureException(e);
            }

            account.lastSelected = time;
            if (!account.successCounter) account.successCounter = 0;
            if (!account.errorCounter) account.errorCounter = 0;
            if (!account.totalSuccessCounter) account.totalSuccessCounter = 0;
            if (!account.totalErrorCounter) account.totalErrorCounter = 0;

            span?.finish();
            return account.save();
        })
};

AccountSchema.statics.countGlobalUsable = async function (this: IAccountModel): Promise<number> {
    const time = Math.floor(Date.now() / 1000);
    const config = await getConfig();
    return this.countDocuments({
        enabled: true,
        errorCounter: { $lt: (config.errorThreshold || 10) },
        $or: [
            { lastSelected: { $exists: false } },
            { lastSelected: { $lt: (time - 50) } }
        ]
    }).exec();
};

AccountSchema.statics.calculateMinDelay = function (this: IAccountModel): Promise<number> {
    return this.countGlobalUsable().then(usable => {
        if (usable <= 0) {
            console.warn(error("Global usable account count is " + usable));
            return 200;
        }
        return MIN_ACCOUNT_DELAY / Math.max(1, usable)
    });
};

AccountSchema.statics.getAccountsPerServer = function (this: IAccountModel, accountType?: string): Promise<{ server: string, count: number }[]> {
    let filter: any = { enabled: true, errorCounter: { $lt: 10 } };
    if (accountType) {
        filter.accountType = accountType;
    }
    return this.aggregate([
        { $match: filter },
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

AccountSchema.statics.getPreferredAccountServer = function (this: IAccountModel, accountType?: string): Promise<Maybe<string>> {
    return this.getAccountsPerServer(accountType).then(accountsPerServer => {
        if (!accountsPerServer || accountsPerServer.length < 1) {
            return undefined;
        }
        // sorted from least to most
        return accountsPerServer[0].server;
    })
}

export const Account: IAccountModel = model<IAccountDocument, IAccountModel>("Account", AccountSchema);
