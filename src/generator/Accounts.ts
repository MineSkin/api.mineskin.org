import { Maybe } from "@mineskin/types";
import { Account, IAccountDocument, User } from "@mineskin/database";
import { Bread } from "../typings/Bread";
import * as Sentry from "@sentry/node";
import { Generator, MIN_ACCOUNT_DELAY } from "./Generator";
import { debug, error, warn } from "../util/colors";
import { Caching } from "./Caching";
import { Discord } from "../util/Discord";
import { getConfig } from "../typings/Configs";
import { FilterQuery } from "mongoose";
import { IMetricsProvider, TYPES as CoreTypes } from "@mineskin/core";
import { container } from "../inversify.config";
import { HOSTNAME } from "../util/host";

export class Accounts {

    public static async findUsable(bread?: Bread): Promise<Maybe<IAccountDocument>> {
        return await Sentry.startSpan({
            op: "account_findUsable",
            name: "Account.findUsable"
        }, async span => {
            const time = Math.floor(Date.now() / 1000);
            const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
            const account = await Account.findOne(await Accounts.usableAccountsQuery()).sort({
                lastUsed: 1,
                lastSelected: 1,
                sameTextureCounter: 1
            }).exec()
            if (!account) {
                console.warn(error(bread?.breadcrumb + " There are no accounts available!"));
                span?.setStatus({
                    code: 2,
                    message: "not_found"
                })
                return undefined;
            }
            if (await Caching.isAccountLocked(account.id)) {
                console.warn(warn(bread?.breadcrumb + " Selecting a different account since " + account.id + " got locked since querying"));
                span?.setStatus({
                    code: 2,
                    message: "not_found"
                })
                return Accounts.findUsable(bread);
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
                metrics.getMetrics().influx.writePoints([{
                    measurement: 'account_selection_difference',
                    tags: {
                        server: HOSTNAME,
                        account: account.id
                    },
                    fields: {
                        lastSelected: selectedDiff,
                        lastUsed: usedDiff
                    }
                }], {
                    database: 'mineskin',
                    precision: 'ms'
                })
            } catch (e) {
                Sentry.captureException(e);
            }

            account.lastSelected = time;
            if (!account.successCounter) account.successCounter = 0;
            if (!account.errorCounter) account.errorCounter = 0;
            if (!account.totalSuccessCounter) account.totalSuccessCounter = 0;
            if (!account.totalErrorCounter) account.totalErrorCounter = 0;

            return await account.save();
        })
    }

    public static async countGlobalUsable(): Promise<number> {
        const time = Math.floor(Date.now() / 1000);
        const config = await getConfig();
        return Account.countDocuments({
            enabled: true,
            $and: [
                {
                    $or: [
                        {lastSelected: {$exists: false}},
                        {lastSelected: {$lt: (time - MIN_ACCOUNT_DELAY)}}
                    ]
                },
                {
                    $or: [
                        {lastUsed: {$exists: false}},
                        {lastUsed: {$lt: (time - MIN_ACCOUNT_DELAY)}}
                    ]
                },
                {
                    $or: [
                        {forcedTimeoutAt: {$exists: false}},
                        {forcedTimeoutAt: {$lt: (time - 650)}}
                    ]
                },
                {
                    $or: [
                        {hiatus: {$exists: false}},
                        {'hiatus.enabled': false},
                        {'hiatus.lastPing': {$lt: (time - 900)}}
                    ]
                }
            ],
            errorCounter: {$lt: (config.errorThreshold || 10)},
            timeAdded: {$lt: (time - 60)}
        }).exec();
    }

    public static async calculateMinDelay(): Promise<number> {
        return Accounts.countGlobalUsable().then(usable => {
            if (usable <= 0) {
                console.warn(error("Global usable account count is " + usable));
                return 200;
            }
            return MIN_ACCOUNT_DELAY / Math.max(1, usable)
        });
    }

    public static async getAccountsPerServer(): Promise<{
        server: string,
        count: number
    }[]> {
        let filter: any = {enabled: true, errorCounter: {$lt: 10}};
        return Account.aggregate([
            {$match: filter},
            {$group: {_id: '$requestServer', count: {$sum: 1}}},
            {$sort: {count: 1}}
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

    public static async getPreferredAccountServer(): Promise<Maybe<string>> {
        return this.getAccountsPerServer().then(accountsPerServer => {
            if (!accountsPerServer || accountsPerServer.length < 1) {
                return undefined;
            }
            // sorted from least to most
            return accountsPerServer[0].server;
        })
    }

    public static async usableAccountsQuery(): Promise<FilterQuery<IAccountDocument>> {
        const time = Math.floor(Date.now() / 1000);
        const config = await getConfig();
        let allowedRequestServers: string[] = ["default", ...await Generator.getRequestServers()];
        return {
            enabled: true,
            id: {$nin: Caching.getLockedAccounts()},
            $and: [
                {
                    $or: [
                        {requestServer: {$exists: false}},
                        {requestServer: null},
                        {requestServer: {$in: allowedRequestServers}}
                    ]
                },
                {
                    $or: [
                        {lastSelected: {$exists: false}},
                        {lastSelected: {$lt: (time - MIN_ACCOUNT_DELAY)}}
                    ]
                },
                {
                    $or: [
                        {lastUsed: {$exists: false}},
                        {lastUsed: {$lt: (time - MIN_ACCOUNT_DELAY)}}
                    ]
                },
                {
                    $or: [
                        {forcedTimeoutAt: {$exists: false}},
                        {forcedTimeoutAt: {$lt: (time - 650)}}
                    ]
                },
                {
                    $or: [
                        {hiatus: {$exists: false}},
                        {'hiatus.enabled': false},
                        {'hiatus.lastPing': {$lt: (time - 900)}}
                    ]
                }
            ],
            errorCounter: {$lt: (config.errorThreshold || 10)},
            timeAdded: {$lt: (time - 60)}
        };
    }

    public static async updateAccountRequestServer(account: IAccountDocument, newRequestServer: string | null, bread?: Bread): Promise<void> {
        if (account.requestServer && account.requestServer !== newRequestServer) {
            account.lastRequestServer = account.requestServer;
            Discord.postDiscordMessage("👤 Account " + account.id + "/" + account.uuid + " moved to " + account.requestServer + " (was " + account.lastRequestServer + ")");
        }
        account.requestServer = newRequestServer;
    }

    public static isAccountOnHiatus(account: IAccountDocument): boolean {
        const now = Math.floor(Date.now() / 1000);
        const fifteenMins = 900;
        return !!account.hiatus &&
            account.hiatus.enabled &&
            (now - account.hiatus.lastPing < fifteenMins || now - account.hiatus.lastLaunch < fifteenMins);
    }

    public static async updateUserMinecraftAccounts(uuid: string) {
        const time = Math.floor(Date.now() / 1000);
        const config = await getConfig();
        const count = await Account.countDocuments({
            user: uuid,
            enabled: true,
            $and: [
                {
                    $or: [
                        {forcedTimeoutAt: {$exists: false}},
                        {forcedTimeoutAt: {$lt: (time - 650)}}
                    ]
                }
            ],
            errorCounter: {$lt: (config.errorThreshold || 10)},
            timeAdded: {$lt: (time - 60)}
        }).exec();
        await User.updateOne({
            uuid: uuid
        }, {
            $set: {
                minecraftAccounts: count
            }
        }).exec();
    }

}