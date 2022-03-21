import { AllStats, CountDuplicateViewStats } from "../typings/AllStats";
import { getConfig } from "../typings/Configs";
import { Account, Skin, Stat } from "../database/schemas";
import * as Sentry from "@sentry/node";
import { MineSkinMetrics } from "../util/metrics";
import { debug } from "../util/colors";

const ACCOUNTS_TOTAL = "accounts.total";
const ACCOUNTS_HEALTHY = "accounts.healthy";
const ACCOUNTS_USABLE = "accounts.healthy";
const ACCOUNTS_TYPE_PREFIX = "accounts.type.";

const GENERATED_UPLOAD_COUNT = "generated.upload.count";
const GENERATED_UPLOAD_DUPLICATE = "generated.upload.duplicate";
const GENERATED_UPLOAD_VIEWS = "generated.upload.views";
const GENERATED_URL_COUNT = "generated.url.count";
const GENERATED_URL_DUPLICATE = "generated.url.duplicate";
const GENERATED_URL_VIEWS = "generated.url.views";
const GENERATED_USER_COUNT = "generated.user.count";
const GENERATED_USER_DUPLICATE = "generated.user.duplicate";
const GENERATED_USER_VIEWS = "generated.user.views";

const SKINS_TOTAL = "skins.total";
const SKINS_UNIQUE = "skins.unique";
const SKINS_DUPLICATE = "skins.duplicate";
const SKINS_VIEWS = "skins.views";

const GENERATED_LAST_YEAR = "generated.time.year"
const GENERATED_LAST_MONTH = "generated.time.month";
const GENERATED_LAST_DAY = "generated.time.day";
const GENERATED_LAST_HOUR = "generated.time.hour";

const GENERATED_DURATION_AVG = "generated.duration.avg";

const GENERATE_SUCCESS = "generate.success";
const GENERATE_FAIL = "generate.fail";

const MINESKIN_TESTER_SUCCESS = "mineskintester.success";
const MINESKIN_TESTER_FAIL = "mineskintester.fail";

export class Stats {

    //TODO: stats for hiatus accounts

    static async get(into: AllStats): Promise<AllStats> {
        const promises: Promise<void>[] = [
            Stat.get(ACCOUNTS_TOTAL).then(n => {
                into.accounts = n;
                into.account.global.total = n;
            }),
            Stat.get(ACCOUNTS_HEALTHY).then(n => {
                into.healthyAccounts = n;
                into.account.global.healthy = n;
            }),
            Stat.get(ACCOUNTS_USABLE).then(n => {
                into.useableAccounts = n;
                into.account.global.usable = n;
            }),

            Promise.all([
                Stat.get(GENERATE_SUCCESS),
                Stat.get(GENERATE_FAIL)
            ]).then(([success, fail]: any[]) => {
                const total = (success as number) + (fail as number);
                into.successRate = Number((success / total).toFixed(3));
                into.generate.successRate = into.successRate;
            }),
            Promise.all([
                Stat.get(MINESKIN_TESTER_SUCCESS),
                Stat.get(MINESKIN_TESTER_FAIL)
            ]).then(([success, fail]: any[]) => {
                const total = (success as number) + (fail as number);
                into.mineskinTesterSuccessRate = Number((success / total).toFixed(3));
                into.generate.testerSuccessRate = into.mineskinTesterSuccessRate;
            }),

            Stat.get(GENERATED_DURATION_AVG).then(n => {
                into.avgGenerateDuration = n;
            }),

            Stat.get(GENERATED_UPLOAD_COUNT).then(n => {
                into.genUpload = n;
                into.generate.source.upload = n;
            }),
            Stat.get(GENERATED_URL_COUNT).then(n => {
                into.genUrl = n;
                into.generate.source.url = n;
            }),
            Stat.get(GENERATED_USER_COUNT).then(n => {
                into.genUser = n;
                into.generate.source.user = n;
            }),

            Stat.get(SKINS_UNIQUE).then(n => {
                into.unique = n;
                into.skin.unique = n;
            }),
            Stat.get(SKINS_DUPLICATE).then(n => {
                into.duplicate = n;
                into.skin.duplicate = n;
            }),
            Stat.get(SKINS_VIEWS).then(n => {
                into.views = n;
                into.skin.views = n;
            }),
            Stat.get(SKINS_TOTAL).then(n => {
                into.total = n;
                into.skin.total = n;
            }),

            Stat.get(GENERATED_LAST_YEAR).then(n => {
                into.lastYear = n;
                into.generate.time.year = n;
            }),
            Stat.get(GENERATED_LAST_MONTH).then(n => {
                into.lastMonth = n;
                into.generate.time.month = n;
            }),
            Stat.get(GENERATED_LAST_DAY).then(n => {
                into.lastDay = n;
                into.generate.time.day = n;
            }),
            Stat.get(GENERATED_LAST_HOUR).then(n => {
                into.lastHour = n;
                into.generate.time.hour = n;
            })
        ];
        return Promise.all(promises).then((ignored: any) => into);
    }

    static async query(): Promise<void> {
        console.log(debug(`Querying stats...`));
        const queryStart = Date.now();
        return Promise.all([
            this.queryAccountStats(),
            this.queryDurationStats(),
            this.queryCountDuplicateViewStats(),
            this.queryTimeFrameStats()
        ]).then((ignored: any) => {
            console.log(debug(`Complete stats query took ${ (Date.now() - queryStart) / 1000 }s`));
        });
    }

    protected static async queryAccountStats(): Promise<void> {
        const config = await getConfig();
        const time = Date.now() / 1000;

        const enabledAccounts = await Account.countDocuments({
            enabled: true
        }).exec();
        // const serverAccounts = await Account.countDocuments({
        //     enabled: true,
        //     requestServer: config.server
        // }).exec();
        const healthyAccounts = await Account.countDocuments({
            enabled: true,
            errorCounter: { $lt: config.errorThreshold }
        })
        const usableAccounts = await Account.countGlobalUsable();

        try {
            const metrics = await MineSkinMetrics.get();
            await metrics.metrics!.influx.writePoints([
                {
                    measurement: 'accounts',
                    tags: {
                        server: metrics.config.server
                    },
                    fields: {
                        total: enabledAccounts,
                        healthy: healthyAccounts,
                        usable: usableAccounts
                    }
                }
            ], {
                database: 'mineskin',
                precision: 's'
            })
        } catch (e) {
            console.warn(e);
            Sentry.captureException(e);
        }


        return Promise.all([
            Stat.set(ACCOUNTS_TOTAL, enabledAccounts),
            Stat.set(ACCOUNTS_HEALTHY, healthyAccounts),
            Stat.set(ACCOUNTS_USABLE, usableAccounts)
        ]).then((ignored: any) => {
        });
    }

    protected static async queryDurationStats(): Promise<void> {
        return Skin.aggregate([
            { "$sort": { time: -1 } },
            { "$limit": 1000 },
            {
                "$group": {
                    "_id": null,
                    "avgGenTime": { "$avg": "$generateDuration" }
                }
            }
        ]).exec().then((res: any[]) => {
            return Stat.set(GENERATED_DURATION_AVG, res[0]["avgGenTime"] as number)
        });
    }

    protected static async queryCountDuplicateViewStats(): Promise<void> {
        return Skin.aggregate([
            {
                "$group":
                    {
                        _id: "$type",
                        duplicate: { $sum: "$duplicate" },
                        views: { $sum: "$views" },
                        count: { $sum: 1 }
                    }
            }
        ]).exec().then(async (res: any[]) => {
            const urlStats = res.find(v => v["_id"] === "url");
            const uploadStats = res.find(v => v["_id"] === "upload");
            const userStats = res.find(v => v["_id"] === "user");

            const stats = <CountDuplicateViewStats>{
                genUpload: Number(uploadStats["count"]),
                genUrl: Number(urlStats["count"]),
                genUser: Number(userStats["count"]),

                duplicateUpload: Number(uploadStats["duplicate"]),
                duplicateUrl: Number(urlStats["duplicate"]),
                duplicateUser: Number(userStats["duplicate"]),

                viewsUpload: Number(uploadStats["views"]),
                viewsUrl: Number(urlStats["views"]),
                viewsUser: Number(userStats["views"])
            };
            const unique = stats.genUpload + stats.genUrl + stats.genUser;
            const duplicate = stats.duplicateUpload + stats.duplicateUrl + stats.duplicateUser;
            const views = stats.viewsUpload + stats.viewsUrl + stats.viewsUser;


            try {
                const metrics = await MineSkinMetrics.get();
                await metrics.metrics!.influx.writePoints([
                    {
                        measurement: 'skins',
                        fields: {
                            total: (unique || 0) + (duplicate || 0),
                            unique: unique || 0,
                            duplicate: duplicate || 0
                        }
                    }
                ], {
                    database: 'mineskin',
                    retentionPolicy: 'one_year',
                    precision: 's'
                })
            } catch (e) {
                console.warn(e);
                Sentry.captureException(e);
            }


            return Promise.all([
                Stat.set(GENERATED_UPLOAD_COUNT, stats.genUpload),
                Stat.set(GENERATED_URL_COUNT, stats.genUrl),
                Stat.set(GENERATED_USER_COUNT, stats.genUser),

                Stat.set(GENERATED_UPLOAD_DUPLICATE, stats.duplicateUpload),
                Stat.set(GENERATED_URL_DUPLICATE, stats.duplicateUrl),
                Stat.set(GENERATED_USER_DUPLICATE, stats.duplicateUser),

                Stat.set(GENERATED_UPLOAD_VIEWS, stats.viewsUpload),
                Stat.set(GENERATED_URL_VIEWS, stats.viewsUrl),
                Stat.set(GENERATED_USER_VIEWS, stats.viewsUser),

                Stat.set(SKINS_UNIQUE, unique),
                Stat.set(SKINS_DUPLICATE, duplicate),
                Stat.set(SKINS_VIEWS, views),
                Stat.set(SKINS_TOTAL, unique + duplicate)
            ]).then((ignored: any) => {
            });
        });
    }

    protected static async queryTimeFrameStats(): Promise<void> {
        const now = Date.now();
        const lastHour = new Date(now - 3.6e+6).getTime() / 1000;
        const lastDay = new Date(now - 8.64e+7).getTime() / 1000;
        const lastMonth = new Date(now - 2.628e+9).getTime() / 1000;
        const lastYear = new Date(now - 3.154e+10).getTime() / 1000;

        return Skin.aggregate([
            {
                $group: {
                    _id: null,
                    lastYear: { $sum: { $cond: [{ $gte: ["$time", lastYear] }, 1, 0] } },
                    lastMonth: { $sum: { $cond: [{ $gte: ["$time", lastMonth] }, 1, 0] } },
                    lastDay: { $sum: { $cond: [{ $gte: ["$time", lastDay] }, 1, 0] } },
                    lastHour: { $sum: { $cond: [{ $gte: ["$time", lastHour] }, 1, 0] } }
                }
            }
        ]).exec().then((res: any[]) => {
            return Promise.all([
                Stat.set(GENERATED_LAST_YEAR, res[0]["lastYear"] as number),
                Stat.set(GENERATED_LAST_MONTH, res[0]["lastMonth"] as number),
                Stat.set(GENERATED_LAST_DAY, res[0]["lastDay"] as number),
                Stat.set(GENERATED_LAST_HOUR, res[0]["lastHour"] as number)
            ]).then((ignored: any) => {
            });
        })
    }


}
