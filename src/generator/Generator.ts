import { MemoizeExpiring } from "@inventivetalent/typescript-memoize";
import {
    base64decode,
    getHashFromMojangTextureUrl,
    hasOwnProperty,
    imgHash,
    isTempFile,
    longAndShortUuid,
    Maybe,
    ONE_MONTH_SECONDS,
    ONE_YEAR_SECONDS,
    PathHolder,
    random32BitNumber,
    sleep,
    stripUuid
} from "../util";
import { Caching } from "./Caching";
import { Authentication, AuthenticationError } from "./Authentication";
import * as Sentry from "@sentry/node";
import { MINECRAFT_SERVICES_PROFILE, Requests } from "./Requests";
import FormData from "form-data";
import { URL } from "url";
import { MOJ_DIR, Temp, UPL_DIR, URL_DIR } from "./Temp";
import { AxiosError, AxiosResponse } from "axios";
import imageSize from "image-size";
import { promises as fs } from "fs";
import * as fileType from "file-type";
import { FileTypeResult } from "file-type";
import { ISizeCalculationResult } from "image-size/dist/types/interface";
import { v4 as randomUuid } from "uuid";
import Jimp from "jimp";
import { getConfig } from "../typings/Configs";
import { ProfileSkinData, SkinMeta, SkinValue } from "../typings/SkinData";
import { GenerateOptions } from "../typings/GenerateOptions";
import { AllStats } from "../typings/AllStats";
import { ClientInfo } from "../typings/ClientInfo";
import { debug, error, info, warn } from "../util/colors";
import { Bread } from "../typings/Bread";
import { Notifications } from "../util/Notifications";
import { MineSkinMetrics } from "../util/metrics";
import { MineSkinOptimus } from "../util/optimus";
import { Discord } from "../util/Discord";
import {
    GENERATE_FAIL,
    GENERATE_SUCCESS,
    GENERATED_UPLOAD_COUNT,
    GENERATED_UPLOAD_DUPLICATE,
    GENERATED_URL_COUNT,
    GENERATED_URL_DUPLICATE,
    GENERATED_USER_COUNT,
    GENERATED_USER_DUPLICATE,
    SKINS_DUPLICATE,
    SKINS_TOTAL,
    SKINS_UNIQUE,
    Stats
} from "./Stats";
import { DelayInfo } from "../typings/DelayInfo";
import { Capes } from "../util/Capes";
import { requestShutdown } from "../index";
import {
    Account,
    IAccountDocument,
    IApiKeyDocument,
    ISkinDataDocument,
    ISkinDocument,
    Skin,
    SkinData,
    SkinModel,
    Stat
} from "@mineskin/database";
import {
    ClientInfo as ClientInfoV2,
    GenerateType,
    MineSkinError,
    SkinInfo,
    SkinVariant,
    SkinVisibility
} from "@mineskin/types";
import { Accounts } from "./Accounts";
import { AuditLogBuilder, GeneratorError, GenError, StatsHandler, TYPES as GeneratorTypes } from "@mineskin/generator";
import { trackRedisGenerated } from "../database/redis";
import { Log } from "../Log";
import { container } from "../inversify.config";
import { IMetricsProvider, IRedisProvider, TYPES as CoreTypes } from "@mineskin/core";
import { HOSTNAME } from "../util/host";
import { UrlChecks } from "./v2/UrlChecks";


// minimum delay for accounts to be used
export const MIN_ACCOUNT_DELAY = 15;

const MAX_ID_TRIES = 10;

const MINESKIN_URL_REGEX = /https?:\/\/minesk(\.in|in\.org)\/([0-9a-zA-Z]+)/i;
const MINECRAFT_TEXTURE_REGEX = /https?:\/\/textures\.minecraft\.net\/texture\/([0-9a-z]+)/i;

export const URL_REGEX = /https?:\/\/.+/i;

const URL_REWRITES = new Map<RegExp, string>([
    [/https?:\/\/imgur\.com\/(.+)/, 'https://i.imgur.com/$1.png'],
    [/https?:\/\/.+namemc\.com\/skin\/(.+)/, 'https://namemc.com/texture/$1.png'],
    [/https?:\/\/.+minecraftskins\.com\/skin\/(\d+)\/.+/, 'https://www.minecraftskins.com/skin/download/$1'],
    [/https?:\/\/minecraft\.novaskin\.me\/skin\/(\d+)\/.+/, 'https://minecraft.novaskin.me/skin/$1/download'],
    [/https?:\/\/minesk(\.in|in\.org)\/([0-9a-zA-Z]+)/, 'https://api.mineskin.org/v2/skins/$2/texture']
]);

const URL_FOLLOW_WHITELIST = [
    "novask.in",
    "imgur.com",
    "i.imgur.com",
    "mineskin.org",
    "minesk.in",
    "api.mineskin.org"
];
const MAX_FOLLOW_REDIRECTS = 5;

export const MAX_IMAGE_SIZE = 20000; // 20KB - about 70x70px at 32bit
const ALLOWED_IMAGE_TYPES = ["image/png"];

export const HASH_VERSION = 4;

export class Generator {

    protected static serverAccounts: number;
    protected static usableAccounts: number;

    private static accountStatsTimer = setInterval(() => Generator.queryAccountStats(), 1000 * 10);

    static lastSave: number = 0;

    static async getDelay(apiKey?: IApiKeyDocument): Promise<DelayInfo> {
        const config = await getConfig();
        const minDelay = await this.getMinDelay();
        if (!apiKey) {
            const d = Math.max(config.delays.default, minDelay);
            return {
                seconds: Math.ceil(d),
                millis: Math.ceil(Math.ceil(d * 1000) / 50) * 50
            }
        }
        const d = Math.max(Math.min(config.delays.default, apiKey.getMinDelay((await getConfig()).delays.defaultApiKey)), minDelay);
        return {
            seconds: Math.ceil(d),
            millis: Math.ceil(Math.ceil(d * 1000) / 50) * 50
        }
    }

    /**
     * minimum delay in seconds
     */
    @MemoizeExpiring(30000)
    static async getMinDelay(): Promise<number> {
        const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
        const delay = await Accounts.calculateMinDelay();
        try {
            metrics.getMetrics().influx.writePoints([{
                measurement: 'delay',
                fields: {
                    delay: delay
                }
            }], {
                database: 'mineskin',
                precision: 's'
            })
        } catch (e) {
            Sentry.captureException(e);
        }
        return delay;
    }

    @MemoizeExpiring(30000)
    static async getPreferredAccountServer(accountType?: string): Promise<string> {
        const config = await getConfig();
        return await Accounts.getPreferredAccountServer() || config.server;
    }

    // Stats

    @MemoizeExpiring(60000)
    static async getStats(): Promise<AllStats> {
        const config = await getConfig();
        const delay = await this.getMinDelay();

        const stats = <AllStats>{
            server: config.server,
            account: {
                global: {},
                local: {}
            },
            skin: {},
            generate: {
                time: {},
                source: {}
            }
        };
        if (this.serverAccounts) {
            stats.serverAccounts = this.serverAccounts;
            stats.account.local.total = this.serverAccounts;
        }
        if (this.usableAccounts) {
            stats.useableAccounts = this.usableAccounts;
            stats.account.local.usable = this.usableAccounts;
        }
        return await Stats.get(stats);
    }

    public static async getRequestServers(): Promise<string[]> {
        const config = await getConfig();
        let servers = [config.server];
        if (config.server in config.requestServers) {
            for (let s of config.requestServers[config.server]) {
                if (!servers.includes(s)) {
                    servers.push(s);
                }
            }
        }
        return servers;
    }

    public static async getServerFromProxy(proxy: string): Promise<string> {
        const config = await getConfig();
        if (config.server === proxy) {
            return config.server;
        }
        for (let s in config.requestServers) {
            if (config.requestServers[s].includes(proxy)) {
                return s;
            }
        }
        return proxy;
    }


    protected static async queryAccountStats(): Promise<void> {
        const start = Date.now();
        const config = await getConfig();

        // const enabledAccounts = await Account.countDocuments({
        //     enabled: true
        // }).exec();
        let serverAccounts: number;
        try {
            serverAccounts = await Account.countDocuments({
                enabled: true,
                requestServer: config.server
            }).exec();
        } catch (e) {
            Sentry.captureException(e);
            console.error("Error counting server accounts, restarting")
            requestShutdown('MONGO_ERROR', 1);
            return;
        }
        this.serverAccounts = serverAccounts;

        const usableAccountDocs = await Account.find(await Accounts.usableAccountsQuery(), {
            _id: 0,
            requestServer: 1
        }).exec();
        let usableAccounts = usableAccountDocs.length;
        this.usableAccounts = usableAccounts;

        // let accountsPerProxy: { [k: string]: number } = {};
        // for (let acc of usableAccountDocs) {
        //     let key = acc.requestServer;
        //     if (!key || key === "null") {
        //         key = "default";
        //     }
        //     accountsPerProxy[key] = (accountsPerProxy[key] || 0) + 1;
        // }

        // const accountTypes = await Account.aggregate([
        //     {
        //         "$match": {
        //             requestServer: {$in: ["default", ...await this.getRequestServers()]}
        //         }
        //     }, {
        //         "$group":
        //             {
        //                 _id: "$accountType",
        //                 count: {$sum: 1}
        //             }
        //     }
        // ]).exec().then((res: any[]) => {
        //     let counts: { [type: string]: number; } = {};
        //     res.forEach(e => {
        //         counts[e["_id"]] = e["count"];
        //     })
        //     return counts;
        // });

        // try {
        //     const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
        //     await metrics.getMetrics().influx.writePoints([
        //         {
        //             measurement: 'accounts',
        //             tags: {
        //                 server: HOSTNAME
        //             },
        //             fields: {
        //                 totalServer: serverAccounts,
        //                 useable: usableAccounts
        //             }
        //         }
        //     ], {
        //         database: 'mineskin',
        //         precision: 's'
        //     })
        //     for (let p in accountsPerProxy) {
        //         await metrics.getMetrics().influx.writePoints([
        //             {
        //                 measurement: 'proxy_accounts',
        //                 tags: {
        //                     server: HOSTNAME,
        //                     proxy: p
        //                 },
        //                 fields: {
        //                     useable: accountsPerProxy[p]
        //                 }
        //             }
        //         ], {
        //             database: 'mineskin',
        //             precision: 's'
        //         })
        //     }
        //
        //     let accountsPerTypePoints: IPoint[] = [];
        //     for (let accountType in accountTypes) {
        //         accountsPerTypePoints.push({
        //             measurement: 'account_types',
        //             tags: {
        //                 server: HOSTNAME,
        //                 type: accountType
        //             },
        //             fields: {
        //                 count: accountTypes[accountType]
        //             }
        //         })
        //     }
        //     await metrics.getMetrics().influx.writePoints(accountsPerTypePoints, {
        //         database: 'mineskin',
        //         precision: 's'
        //     })
        // } catch (e) {
        //     console.warn(e);
        //     Sentry.captureException(e);
        // }

        console.log(debug(`Took ${ (Date.now() - start) }ms for account stats`));
    }

    static async saveOriginalSkin(account: IAccountDocument, save: boolean = true): Promise<Maybe<string>> {
        const skinData = await this.getSkinData(account);
        if (skinData?.decodedValue?.textures?.SKIN?.url) {
            account.originalSkinTexture = skinData.decodedValue.textures.SKIN.url;
            account.originalSkinVariant = skinData.decodedValue.textures.SKIN.metadata?.model as SkinVariant || SkinVariant.CLASSIC;
            if (save) await account.save();
            console.log(debug(`Saved original skin texture for ${ account.id }/${ account.uuid } (${ account.originalSkinTexture } / ${ account.originalSkinVariant })`))
            return account.originalSkinTexture;
        }
        return undefined;
    }

    static async restoreOriginalSkinASAP(account: IAccountDocument): Promise<void> {
        await Generator.restoreOriginalSkin(account);
        // let usedDiff = Math.round((Date.now() / 1000) - (account.lastUsed || 0));
        // if (usedDiff > MIN_ACCOUNT_DELAY) {
        //     await Generator.restoreOriginalSkin(account);
        // } else {
        //     await sleep(((MIN_ACCOUNT_DELAY - usedDiff) + 5) * 1000);
        //     await Generator.restoreOriginalSkin(account);
        // }
    }

    static async restoreOriginalSkin(account: IAccountDocument): Promise<void> {
        if (!account.originalSkinTexture) return;
        await this.changeSkinUrl(account, account.originalSkinTexture, account.originalSkinVariant || SkinVariant.CLASSIC);
        console.log(debug(`Restored original skin texture for ${ account.id }/${ account.uuid }`))
    }

    /// SAVING

    static async makeNewSkinId(): Promise<number> {
        return this.makeRandomSkinId(0);
    }

    protected static async makeRandomSkinId(tryN = 0): Promise<number> {
        if (tryN > MAX_ID_TRIES) {
            throw new GeneratorError(GenError.FAILED_TO_CREATE_ID, "Failed to create unique skin ID after " + tryN + " tries!");
        }
        const rand = await random32BitNumber();
        const newId = (await MineSkinOptimus.get()).encode(rand);
        const existing = await Skin.findOne({id: newId}, "id").lean().exec();
        if (existing && existing.hasOwnProperty("id")) {
            return this.makeRandomSkinId(tryN + 1);
        }
        return newId;
    }

    static async getSkinDataWithRetry(accountOrUuid: IAccountDocument | {
        uuid: string
    }, type: string, expectedUrl?: string, breadcrumb?: string, t: number = 2): Promise<ProfileSkinData> {
        let skinData = await this.getSkinData(accountOrUuid, t == 1);
        if (expectedUrl) {
            if (expectedUrl !== skinData.decodedValue!.textures!.SKIN!.url) {
                console.warn(warn(breadcrumb + " Skin url returned by skin change does not match url returned by data query (" + t + ") (" + expectedUrl + " != " + skinData.decodedValue!.textures!.SKIN!.url + ")"));

                const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
                let m = metrics.getMetric('url_mismatch')
                    .tag('server', HOSTNAME)
                    .tag('type', type);
                if ('id' in accountOrUuid) {
                    m.tag('account', accountOrUuid.id)
                }
                m.inc()

                if (t > 0) {
                    await sleep(3000);
                    return await this.getSkinDataWithRetry(accountOrUuid, type, expectedUrl, breadcrumb, t - 1);
                }
            }
        }
        return skinData;
    }

    static async getSkinData(accountOrUuid: IAccountDocument | {
        uuid: string
    }, invalidate?: boolean): Promise<ProfileSkinData> {
        return await Sentry.startSpan({
            op: "generate_getSkinData",
            name: "getSkinData"
        }, async span => {
            const uuid = stripUuid(accountOrUuid.uuid);
            const data = await Caching.getSkinData(uuid, invalidate);
            if (!data || !data.value) {
                span?.setStatus({
                    code: 2,
                    message: "internal_error"
                });
                throw new GeneratorError(GenError.INVALID_SKIN_DATA, "Skin data was invalid", {
                    httpCode: 500,
                    account: hasOwnProperty(accountOrUuid, "id") ? accountOrUuid as IAccountDocument : undefined,
                    details: data
                });
            }
            const decodedValue = this.decodeValue(data);
            if (!decodedValue || !decodedValue.textures || !decodedValue.textures.SKIN) {
                span?.setStatus({
                    code: 2,
                    message: "internal_error"
                });
                throw new GeneratorError(GenError.INVALID_SKIN_DATA, "Skin data has no skin info", {
                    httpCode: 500,
                    account: hasOwnProperty(accountOrUuid, "id") ? accountOrUuid as IAccountDocument : undefined,
                    details: data
                });
            }
            return data;
        })


    }


    protected static async saveSkin(result: GenerateResult, options: GenerateOptions, client: ClientInfo, type: GenerateType, start: number): Promise<ISkinDocument> {
        return await Sentry.startSpan({
            op: "generate_saveSkin",
            name: "saveSkin"
        }, async span => {
            const config = await getConfig();
            const id = await this.makeNewSkinId();
            const skinUuid = stripUuid(randomUuid());
            const time = Date.now();
            const duration = time - start;

            const textures = result.data!.decodedValue!.textures;
            const mcTextureHash = getHashFromMojangTextureUrl(textures.SKIN!.url!);
            const mcCapeTextureHash = textures.CAPE ? getHashFromMojangTextureUrl(textures.CAPE!.url!) : undefined;

            let skinData: Maybe<ISkinDataDocument> = new SkinData(<ISkinDataDocument>{
                hash: {
                    skin: {
                        minecraft: mcTextureHash,
                        mineskin: result.meta?.imageHash
                    },
                    cape: {
                        minecraft: mcCapeTextureHash
                    }
                },
                value: result.data!.value,
                signature: result.data!.signature,
                meta: {
                    variant: textures.SKIN?.metadata?.model || options.variant
                },
                generatedBy: {
                    server: result.account?.requestServer || config.server,
                    account: result.account?.uuid || "unknown"
                }
            });
            try {
                skinData = await skinData.save();
            } catch (e) {
                console.error("failed to save skin data", e);
                Sentry.captureException(e);
                skinData = undefined;
            }

            let skin = new Skin(<ISkinDocument>{
                id: id,
                skinUuid: skinUuid,

                hash: result.meta?.imageHash,
                uuid: result.meta?.uuid,

                name: options.name,
                model: options.model,
                variant: options.variant,
                visibility: options.visibility,

                data: skinData?._id,

                value: result.data!.value,
                signature: result.data!.signature,
                url: result.data!.decodedValue!.textures!.SKIN!.url!,
                capeUrl: result.data?.decodedValue?.textures?.CAPE?.url,
                minecraftTextureHash: mcTextureHash,
                textureHash: result.meta?.mojangHash,
                minecraftSkinId: result.meta?.minecraftSkinId,

                time: (time / 1000),
                generateDuration: duration,

                account: result.account?.id,
                breadcrumb: options.breadcrumb,
                type: type,
                server: result.account?.requestServer || config.server,

                via: client.via,
                ua: client.userAgent.original,
                apiKey: client.apiKeyId,

                duplicate: 0,
                views: 0,
                hv: HASH_VERSION
            })

            skin = await skin.save();
            //TODO: fix this message for user generate
            console.log(info(options.breadcrumb + " New skin saved " + skin.skinUuid + " - generated in " + duration + "ms by " + result.account?.accountType + " account #" + result.account?.id));
            Generator.lastSave = Date.now();
            return skin;
        })


    }

    protected static async getDuplicateOrSaved(result: GenerateResult, options: GenerateOptions, client: ClientInfo, type: GenerateType, start: number): Promise<SavedSkin> {
        const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
        if (result.duplicate) {
            const statPromises = [];
            statPromises.push(Stat.inc(SKINS_DUPLICATE));
            statPromises.push(Stat.inc(SKINS_TOTAL));
            // statPromises.push(Stats.incTimeFrame());
            // stats for duplicate
            switch (type) {
                case GenerateType.UPLOAD:
                    statPromises.push(Stat.inc(GENERATED_UPLOAD_DUPLICATE));
                    break;
                case GenerateType.URL:
                    statPromises.push(Stat.inc(GENERATED_URL_DUPLICATE));
                    break;
                case GenerateType.USER:
                    statPromises.push(Stat.inc(GENERATED_USER_DUPLICATE));
                    break;
            }
            await Promise.all(statPromises);

            return new SavedSkin(result.duplicate, true);
        }
        if (result.data) {
            try {
                metrics.getMetric('generate_new')
                    .tag("server", HOSTNAME)
                    .tag("type", type)
                    .tag("userAgent", client.userAgent.ua)
                    .tag("genEnv", "api")
                    .inc();
                //TODO: remove
                metrics.getMetric('generate_new_duplicate')
                    .tag("newOrDuplicate", "new")
                    .tag("server", HOSTNAME)
                    .tag("type", type)
                    .tag("userAgent", client.userAgent.ua)
                    .tag("genEnv", "api")
                    .inc();
            } catch (e) {
                Sentry.captureException(e);
            }
            try {
                const statsHandler = container.get<StatsHandler>(GeneratorTypes.StatsHandler);
                statsHandler.trackClientSkinGenerated({
                    key: client.apiKeyId,
                    agent: client.userAgent.ua
                } as ClientInfoV2, true, false).catch(e => {
                    Sentry.captureException(e);
                })
            } catch (e) {
                Sentry.captureException(e);
            }
            try {
                await trackRedisGenerated(true, client.apiKeyId, client.userAgent.ua);
            } catch (e) {
                Sentry.captureException(e);
            }
            if (!!client.billable || !!client.metered /*|| !!client.useCredits*/) {
                try {
                    const date = new Date();

                    const redis = container.get<IRedisProvider>(CoreTypes.RedisProvider);

                    if (!!client.metered) {
                        const usageKey = `mineskin:usage:apikey:${ client.apiKeyId }:meter`;
                        const incr = await redis.client.incr(usageKey);

                        if (incr && (incr % 20 === 0)) {
                            await redis.pub.publish(`mineskin:invalidations:billable`, `${ client.apiKeyId }`);
                        }

                        redis.client.expire(usageKey, ONE_MONTH_SECONDS * 3);
                    }

                    //TODO: actually check if client has enough credits
                    // if (!!client.useCredits) {
                    //     if (!client.user) {
                    //         console.warn(warn(options.breadcrumb + " No user for credit usage"));
                    //         Sentry.captureException(new Error("No user for credit usage"));
                    //     } else {
                    //         Credit.findFirstValidForUser(client.user).then(credit => {
                    //             if (!credit) {
                    //                 console.warn(warn(options.breadcrumb + " No credit for user"));
                    //                 Sentry.captureException(new Error("No valid credit for user"));
                    //             } else {
                    //                 credit.decrement(1).catch(e => {
                    //                     console.log(e);
                    //                     Sentry.captureException(e);
                    //                 })
                    //             }
                    //         }).catch(e => {
                    //             console.log(e);
                    //             Sentry.captureException(e);
                    //         })
                    //     }
                    // }

                    const billableKeyMonth = `mineskin:generated:apikey:${ client.apiKeyId }:${ date.getFullYear() }:${ date.getMonth() + 1 }:billable`;
                    const billableKeyDate = `mineskin:generated:apikey:${ client.apiKeyId }:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ date.getDate() }:billable`

                    await redis.client.multi()
                        ?.incr(billableKeyMonth)
                        ?.incr(billableKeyDate)
                        ?.expire(billableKeyMonth, ONE_YEAR_SECONDS * 2)
                        ?.expire(billableKeyDate, ONE_MONTH_SECONDS * 3)
                        .exec()
                        .catch(e => {
                            Log.l.debug(e.replies);
                            Log.l.debug(e.errorIndexes);
                            Sentry.captureException(e, {
                                extra: {
                                    op: "redis_getDuplicateOrSaved_billable",
                                }
                            });
                            throw e;
                        });

                } catch (e) {
                    Sentry.captureException(e);
                }
            }
            const doc = await this.saveSkin(result, options, client, type, start)

            const statPromises = [];
            // stats for newly generated, not duplicate
            statPromises.push(Stat.inc(SKINS_UNIQUE));
            statPromises.push(Stat.inc(SKINS_TOTAL));
            switch (type) {
                case GenerateType.UPLOAD:
                    statPromises.push(Stat.inc(GENERATED_UPLOAD_COUNT));
                    break;
                case GenerateType.URL:
                    statPromises.push(Stat.inc(GENERATED_URL_COUNT));
                    break;
                case GenerateType.USER:
                    statPromises.push(Stat.inc(GENERATED_USER_COUNT));
                    break;
            }
            await Promise.all(statPromises);

            return new SavedSkin(doc, false);
        }
        // shouldn't ever get here
        throw new MineSkinError('unknown', "Something went wrong while generating");
    }

    /// DUPLICATE CHECKS

    protected static async findDuplicateFromUrl(url: string, options: GenerateOptions, type: GenerateType): Promise<Maybe<ISkinDocument>> {
        const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
        if (!url || url.length < 8 || !url.startsWith("http")) {
            return undefined;
        }

        return await Sentry.startSpan({
            op: "generate_findDuplicateFromUrl",
            name: "findDuplicateFromUrl",
        }, async span => {
            const mineskinUrlResult = MINESKIN_URL_REGEX.exec(url);
            if (!!mineskinUrlResult && mineskinUrlResult.length >= 3) {
                let existingSkin;
                if (isNaN(mineskinUrlResult[2] as any)) {
                    const mineskinUuid = mineskinUrlResult[2];
                    existingSkin = await Skin.findOne({
                        skinUuid: mineskinUuid
                    }).exec();
                } else {
                    const mineskinId = parseInt(mineskinUrlResult[2]);
                    existingSkin = await Skin.findOne({
                        id: mineskinId
                    }).exec();
                }
                if (existingSkin) {
                    console.log(debug(options.breadcrumb + " Found existing skin from mineskin url"));
                    existingSkin.duplicate++;
                    try {
                        metrics.getMetric('generate_duplicate')
                            .tag("server", HOSTNAME)
                            .tag("source", DuplicateSource.MINESKIN_URL)
                            .tag("type", type)
                            .tag("genEnv", "api")
                            .inc();
                        //TODO: remove
                        metrics.getMetric('generate_new_duplicate')
                            .tag("newOrDuplicate", "duplicate")
                            .tag("server", HOSTNAME)
                            .tag("source", DuplicateSource.MINESKIN_URL)
                            .tag("type", type)
                            .tag("genEnv", "api")
                            .inc();
                    } catch (e) {
                        Sentry.captureException(e);
                    }
                    try {
                        const redis = container.get<IRedisProvider>(CoreTypes.RedisProvider);
                        redis.client.incr("mineskin:generated:total:duplicate");
                    } catch (e) {
                        Sentry.captureException(e);
                    }
                    span?.setAttribute("duplicate", true);
                    return await existingSkin.save();
                } else {
                    span?.setAttribute("duplicate", false);
                    return undefined;
                }
            }

            const minecraftTextureResult = MINECRAFT_TEXTURE_REGEX.exec(url);
            if (!!minecraftTextureResult && minecraftTextureResult.length >= 2) {
                const textureUrl = minecraftTextureResult[0];
                const textureHash = minecraftTextureResult[1];
                const textureQuery = {
                    $or: [
                        {url: textureUrl},
                        {minecraftTextureHash: textureHash}
                    ]
                };
                this.appendOptionsToDuplicateQuery(options, textureQuery);
                const existingSkin = await Skin.findOne(textureQuery);
                if (existingSkin) {
                    console.log(debug(options.breadcrumb + " Found existing skin with same minecraft texture url/hash"));
                    existingSkin.duplicate++;
                    try {
                        metrics.getMetric('generate_duplicate')
                            .tag("server", HOSTNAME)
                            .tag("source", DuplicateSource.TEXTURE_URL)
                            .tag("type", type)
                            .tag("genEnv", "api")
                            .inc();
                        //TODO: remove
                        metrics.getMetric('generate_new_duplicate')
                            .tag("newOrDuplicate", "duplicate")
                            .tag("server", HOSTNAME)
                            .tag("source", DuplicateSource.TEXTURE_URL)
                            .tag("type", type)
                            .tag("genEnv", "api")
                            .inc();
                    } catch (e) {
                        Sentry.captureException(e);
                    }
                    span?.setAttribute("duplicate", true);
                    return await existingSkin.save();
                } else {
                    span?.setAttribute("duplicate", false);
                    return undefined;
                }
            }

            span?.setAttribute("duplicate", false);
            return undefined;
        })
    }

    protected static async findDuplicateFromImageHash(hash: string, options: GenerateOptions, client: ClientInfo, type: GenerateType): Promise<Maybe<ISkinDocument>> {
        const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
        if (!hash || hash.length < 30) {
            return undefined;
        }

        return await Sentry.startSpan({
            op: "generate_findDuplicateFromImageHash",
            name: "findDuplicateFromImageHash"
        }, async span => {
            const query = {
                hash: hash
            };
            this.appendOptionsToDuplicateQuery(options, query);
            const existingSkin = await Skin.findOne(query).exec();
            if (existingSkin) {
                console.log(debug(options.breadcrumb + " Found existing skin with same image hash"));
                existingSkin.duplicate++;
                try {
                    metrics.getMetric('generate_duplicate')
                        .tag("server", HOSTNAME)
                        .tag("source", DuplicateSource.IMAGE_HASH)
                        .tag("type", type)
                        .tag("userAgent", client.userAgent.ua)
                        .tag("genEnv", "api")
                        .inc();
                    //TODO: remove
                    metrics.getMetric('generate_new_duplicate')
                        .tag("newOrDuplicate", "duplicate")
                        .tag("server", HOSTNAME)
                        .tag("source", DuplicateSource.IMAGE_HASH)
                        .tag("type", type)
                        .tag("userAgent", client.userAgent.ua)
                        .tag("genEnv", "api")
                        .inc();
                } catch (e) {
                    Sentry.captureException(e);
                }
                try {
                    const statsHandler = container.get<StatsHandler>(GeneratorTypes.StatsHandler);
                    statsHandler.trackClientSkinGenerated({
                        key: client.apiKeyId,
                        agent: client.userAgent.ua
                    } as ClientInfoV2, false, false).catch(e => {
                        Sentry.captureException(e);
                    })
                } catch (e) {
                    Sentry.captureException(e);
                }
                try {
                    await trackRedisGenerated(false, client.apiKeyId, client.userAgent.ua);
                } catch (e) {
                    Sentry.captureException(e);
                }
                span?.setAttribute("duplicate", true);
                return await existingSkin.save();
            } else {
                span?.setAttribute("duplicate", false);
                return undefined;
            }
        })


    }

    protected static async findDuplicateFromUuid(uuid: string, options: GenerateOptions, type: GenerateType): Promise<Maybe<ISkinDocument>> {
        const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
        if (!uuid || uuid.length < 34) {
            return undefined;
        }

        return await Sentry.startSpan({
            op: "generate_findDuplicateFromUuid",
            name: "findDuplicateFromUuid"
        }, async span => {
            const time = Math.floor(Date.now() / 1000);
            const existingSkin = await Skin.findOne({
                uuid: uuid,
                name: options.name, visibility: options.visibility,
                time: {$gt: (time - 1800)} // Wait 30 minutes before generating again
            }).exec();
            if (existingSkin) {
                console.log(debug(options.breadcrumb + " Found existing skin for user"));
                existingSkin.duplicate++;
                try {
                    metrics.getMetric('generate_duplicate')
                        .tag("server", HOSTNAME)
                        .tag("source", DuplicateSource.USER_UUID)
                        .tag("type", type)
                        .tag("genEnv", "api")
                        .inc();
                    metrics.getMetric('generate_new_duplicate')
                        .tag("newOrDuplicate", "duplicate")
                        .tag("server", HOSTNAME)
                        .tag("source", DuplicateSource.USER_UUID)
                        .tag("type", type)
                        .tag("genEnv", "api")
                        .inc();
                } catch (e) {
                    Sentry.captureException(e);
                }
                span?.setAttribute("duplicate", true);
                return await existingSkin.save();
            } else {
                span?.setAttribute("duplicate", false);
                return undefined;
            }
        });


    }

    /// GENERATE URL

    public static async generateFromUrlAndSave(url: string, options: GenerateOptions, client: ClientInfo): Promise<SavedSkin> {
        const start = Date.now();
        const data = await this.generateFromUrl(url, options, client);
        const skin = await this.getDuplicateOrSaved(data, options, client, GenerateType.URL, start);
        const end = Date.now();
        const metrics = container.get<MineSkinMetrics>(CoreTypes.MetricsProvider);
        metrics.durationMetric(end - start, GenerateType.URL, skin.duplicate);
        return skin;
    }

    protected static async generateFromUrl(originalUrl: string, options: GenerateOptions, client: ClientInfo): Promise<GenerateResult> {
        const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
        console.log(info(options.breadcrumb + " [Generator] Generating from url"));
        Sentry.setExtra("generate_url", originalUrl);

        return await Sentry.startSpan({
            op: "generate_generateFromUrl",
            name: "generateFromUrl"
        }, async span => {
            if (UrlChecks.isBlockedHost(originalUrl)) {
                span?.setStatus({
                    code: 2,
                    message: "invalid_argument"
                });
                throw new GeneratorError(GenError.INVALID_IMAGE_URL, "Invalid host", {
                    httpCode: 400,
                    details: originalUrl
                });
            }

            try {
                metrics.getMetric('generate_url_hosts')
                    .tag('host', new URL(originalUrl).host.replace(/[0-9]/g, 'x').substring(0, 32))
                    .inc();
            } catch (e) {
                Sentry.captureException(e);
            }

            //TODO: filter out requests for localhost 127.0.0.1 etc.

            let account: Maybe<IAccountDocument> = undefined;
            let tempFile: Maybe<PathHolder> = undefined;
            try {
                // Check original url for duplicate or for mineskin urls
                const originalUrlDuplicate = await this.findDuplicateFromUrl(originalUrl, options, GenerateType.URL);
                if (originalUrlDuplicate) {
                    return {
                        duplicate: originalUrlDuplicate
                    };
                }
                // Fix user errors
                originalUrl = this.rewriteUrl(originalUrl, options);
                // Try to find the source image
                const followResponse = await this.followUrl(originalUrl, options.breadcrumb);
                if (!followResponse || typeof followResponse === 'string') {
                    span?.setStatus({
                        code: 2,
                        message: "invalid_argument"
                    });
                    throw new GeneratorError(GenError.INVALID_IMAGE_URL,
                        "Failed to find image from url" + (typeof followResponse === 'string' ? ": " + followResponse : ""),
                        {httpCode: 400, details: originalUrl});
                }
                // Validate response headers
                const url = this.getUrlFromResponse(followResponse, originalUrl);
                if (!url) {
                    span?.setStatus({
                        code: 2,
                        message: "invalid_argument"
                    });
                    throw new GeneratorError(GenError.INVALID_IMAGE_URL, "Failed to follow url", {
                        httpCode: 400,
                        details: originalUrl
                    });
                }
                Sentry.setExtra("generate_url_followed", url);
                // Check for duplicate from url again, if the followed url is different
                if (url !== originalUrl) {
                    const followedUrlDuplicate = await this.findDuplicateFromUrl(url, options, GenerateType.URL);
                    if (followedUrlDuplicate) {
                        return {
                            duplicate: followedUrlDuplicate
                        };
                    }
                    if (UrlChecks.isBlockedHost(originalUrl)) {
                        span?.setStatus({
                            code: 2,
                            message: "invalid_argument"
                        });
                        throw new GeneratorError(GenError.INVALID_IMAGE_URL, "Invalid host", {
                            httpCode: 400,
                            details: url
                        });
                    }

                }
                console.log(debug(options.breadcrumb + " " + url));
                const contentType = this.getContentTypeFromResponse(followResponse);
                console.log(debug(options.breadcrumb + " " + contentType));
                Sentry.setExtra("generate_contentType", contentType);
                if (!contentType || !contentType.startsWith("image") || !ALLOWED_IMAGE_TYPES.includes(contentType)) {
                    span?.setStatus({
                        code: 2,
                        message: "invalid_argument"
                    });
                    throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image content type: " + contentType, {
                        httpCode: 400,
                        details: originalUrl
                    });
                }
                const size = this.getSizeFromResponse(followResponse);
                console.log(debug(options.breadcrumb + " size: " + size));
                Sentry.setExtra("generate_contentLength", size);
                if (!size || size < 100 || size > MAX_IMAGE_SIZE) {
                    span?.setStatus({
                        code: 2,
                        message: "invalid_argument"
                    });
                    throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image file size", {
                        httpCode: 400
                    });
                }

                // Download the image temporarily
                tempFile = await Temp.file({
                    dir: URL_DIR
                });
                try {
                    tempFile = await Temp.downloadImage(url, tempFile)
                } catch (e) {
                    span?.setStatus({
                        code: 2,
                        message: "internal_error"
                    });
                    throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to download image", {httpCode: 500});
                }

                // Validate downloaded image file
                const tempFileValidation = await this.validateTempFile(tempFile.path, options, client, GenerateType.URL);
                if (tempFileValidation.duplicate) {
                    // found a duplicate
                    return tempFileValidation;
                }

                if (options.checkOnly) {
                    span?.setStatus({
                        code: 2,
                        message: "not_found"
                    });
                    throw new GeneratorError(GenError.NO_DUPLICATE, "No duplicate found", {httpCode: 404})
                }

                /// Run generation for new skin

                account = await this.getAndAuthenticateAccount(options);
                await this.clearCapeIfRequired(account);

                const skinResponse = await this.changeSkinUrl(account, url, options.variant, options.breadcrumb);
                return this.handleSkinChangeResponse(skinResponse, GenerateType.URL, options, client, account, tempFileValidation);
            } catch (e) {
                span?.setStatus({
                    code: 2,
                    message: "internal_error"
                });
                await this.handleGenerateError(e, GenerateType.URL, options, client, account);
                throw e;
            } finally {
                if (tempFile && isTempFile(tempFile)) {
                    tempFile.remove();
                }
            }
        })
    }

    protected static async changeSkinUrl(account: IAccountDocument, url: string, variant: string, breadcrumb?: string): Promise<AxiosResponse> {
        AuditLogBuilder.create()
            .context('account')
            .action('upload_skin')
            .resource('account', account.uuid)
            .meta({
                variant: variant,
                method: 'url',
                breadcrumb: breadcrumb
            })
            .insert();
        const body = {
            variant: variant,
            url: url
        };
        return await Requests.dynamicRequestWithAccount(MINECRAFT_SERVICES_PROFILE, {
            method: "POST",
            url: "/minecraft/profile/skins",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${ account.accessToken }`
            },
            data: body
        }, account, breadcrumb).catch(err => {
            if (err.response) {
                if (err.response?.status === 429) {
                    Sentry.captureException(new Error("skin change 429"), {
                        level: 'fatal',
                        extra: {
                            error_account: account.id
                        }
                    });
                    account.forcedTimeoutAt = Math.floor(Date.now() / 1000);
                    account.errorCounter++;
                    account.totalErrorCounter++;
                    console.warn(warn(breadcrumb + " [Generator] Account #" + account.id + " forced timeout (skin change 429)"));
                    console.debug(JSON.stringify(err.response?.data));
                }
                let msg = (err.response as AxiosResponse).data?.errorMessage ?? "Failed to change skin";
                throw new GeneratorError(GenError.SKIN_CHANGE_FAILED, msg, {
                    httpCode: (err.response as AxiosResponse).status,
                    account,
                    error: err
                });
            }
            throw err;
        });
    }

    protected static rewriteUrl(urlStr: string, bread: Bread): string {
        for (let [pattern, replacement] of URL_REWRITES.entries()) {
            if (pattern.test(urlStr)) {
                const str = urlStr.replace(pattern, replacement);
                console.log(debug(`${ bread.breadcrumb } Rewrite ${ urlStr } -> ${ str }`));
                return str;
            }
        }
        return urlStr;
    }

    protected static async followUrl(urlStr: string, breadcrumb?: string): Promise<string | Maybe<AxiosResponse>> {
        if (!urlStr) return "no url";

        return await Sentry.startSpan({
            op: "generate_followUrl",
            name: "followUrl"
        }, async span => {
            try {
                const url = new URL(urlStr);
                if (!url.host || !url.pathname) {
                    return "invalid host or path";
                }
                if (!url.protocol || (url.protocol !== "http:" && url.protocol !== "https:")) {
                    return "invalid protocol";
                }
                const follow = URL_FOLLOW_WHITELIST.includes(url.host!);
                return await Requests.genericRequest({
                    method: "HEAD",
                    url: url.href,
                    maxRedirects: follow ? MAX_FOLLOW_REDIRECTS : 0,
                    timeout: 1000,
                    headers: {
                        "User-Agent": "MineSkin"
                    },
                    maxBodyLength: MAX_IMAGE_SIZE,
                    maxContentLength: MAX_IMAGE_SIZE,
                }, breadcrumb).then(res => {
                    return res;
                });
            } catch (e) {
                Sentry.captureException(e, {
                    extra: {
                        url: urlStr,
                        breadcrumb: breadcrumb
                    }
                });
                if (e?.message?.includes("timeout")) {
                    return "timeout";
                }
                if (e instanceof AxiosError) {
                    return e.message;
                }
            }
            return "request failed";
        })
    }


    /// GENERATE UPLOAD

    public static async generateFromUploadAndSave(file: Express.Multer.File, options: GenerateOptions, client: ClientInfo): Promise<SavedSkin> {
        const start = Date.now();
        const data = await this.generateFromUpload(file, options, client);
        const skin = await this.getDuplicateOrSaved(data, options, client, GenerateType.UPLOAD, start);
        const end = Date.now();
        const metrics = container.get<MineSkinMetrics>(CoreTypes.MetricsProvider);
        metrics.durationMetric(end - start, GenerateType.UPLOAD, skin.duplicate);
        return skin;
    }

    protected static async generateFromUpload(file: Express.Multer.File, options: GenerateOptions, client: ClientInfo): Promise<GenerateResult> {
        console.log(info(options.breadcrumb + " [Generator] Generating from upload"));
        Sentry.setExtra("generate_file", file.filename);

        return await Sentry.startSpan({
            op: "generate_generateFromUpload",
            name: "generateFromUpload"
        }, async span => {
            let account: Maybe<IAccountDocument> = undefined;
            let tempFile: Maybe<PathHolder> = undefined;
            try {
                // Copy uploaded file
                tempFile = await Temp.file({
                    dir: UPL_DIR
                });
                try {
                    tempFile = await Temp.copyUploadedImage(file, tempFile);
                } catch (e) {
                    span.setStatus({
                        code: 2,
                        message: "internal_error"
                    });
                    throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to upload image", {
                        httpCode: 500,
                        error: e
                    });
                }

                // Validate uploaded image file
                const tempFileValidation = await this.validateTempFile(tempFile.path, options, client, GenerateType.UPLOAD);
                if (tempFileValidation.duplicate) {
                    // found a duplicate
                    return tempFileValidation;
                }

                if (options.checkOnly) {
                    span.setStatus({
                        code: 2,
                        message: "not_found"
                    });
                    throw new GeneratorError(GenError.NO_DUPLICATE, "No duplicate found", {httpCode: 400})
                }

                /// Run generation for new skin

                account = await this.getAndAuthenticateAccount(options);
                await this.clearCapeIfRequired(account);

                const skinResponse = await this.changeSkinUpload(account, tempFileValidation.buffer!, options.variant, options.breadcrumb);
                return this.handleSkinChangeResponse(skinResponse, GenerateType.UPLOAD, options, client, account, tempFileValidation);
            } catch (e) {
                span.setStatus({
                    code: 2,
                    message: "internal_error"
                });
                await this.handleGenerateError(e, GenerateType.UPLOAD, options, client, account);
                throw e;
            } finally {
                if (tempFile && isTempFile(tempFile)) {
                    tempFile.remove();
                }
            }
        })


    }

    protected static async changeSkinUpload(account: IAccountDocument, file: Buffer, variant: string, breadcrumb?: string): Promise<AxiosResponse> {
        AuditLogBuilder.create()
            .context('account')
            .action('upload_skin')
            .resource('account', account.uuid)
            .meta({
                variant: variant,
                method: 'upload',
                breadcrumb: breadcrumb
            })
            .insert();
        const body = new FormData();
        body.append("variant", variant);
        body.append("file", file, {
            filename: "skin.png",
            contentType: "image/png"
        });
        return await Requests.dynamicRequestWithAccount(MINECRAFT_SERVICES_PROFILE, {
            method: "POST",
            url: "/minecraft/profile/skins",
            headers: body.getHeaders({
                "Authorization": `Bearer ${ account.accessToken }`
            }),
            data: body
        }, account, breadcrumb).catch(err => {
            if (err.response) {
                Sentry.captureException(new Error("skin change 429"), {
                    level: 'fatal',
                    extra: {
                        error_account: account.id
                    }
                });
                if (err.response?.status === 429) {
                    account.forcedTimeoutAt = Math.floor(Date.now() / 1000);
                    account.errorCounter++;
                    account.totalErrorCounter++;
                    console.warn(warn(breadcrumb + " [Generator] Account #" + account.id + " forced timeout (skin change 429)"));
                    console.debug(JSON.stringify(err.response?.data));
                }
                let msg = (err.response as AxiosResponse).data?.errorMessage ?? "Failed to change skin";
                throw new GeneratorError(GenError.SKIN_CHANGE_FAILED, msg, {
                    httpCode: (err.response as AxiosResponse).status,
                    account,
                    error: err
                });
            }
            throw err;
        });
    }

    static async handleSkinChangeResponse(skinResponse: AxiosResponse, type: GenerateType, options: GenerateOptions, client: ClientInfo, account: IAccountDocument, tempFileValidation: TempFileValidationResult): Promise<GenerateResult> {
        return await Sentry.startSpan({
            op: "generate_handleSkinChangeResponse",
            name: "handleSkinChangeResponse"
        }, async span => {
            const skinChangeResponse = skinResponse.data as SkinChangeResponse;
            const minecraftSkinId = skinChangeResponse?.skins[0]?.id;

            AuditLogBuilder.create()
                .context('account')
                .action('skin_changed')
                .resource('account', account.uuid)
                .meta({
                    minecraftSkinId: minecraftSkinId,
                    breadcrumb: options.breadcrumbId
                })
                .insert();

            const config = await getConfig();

            await sleep(200);

            let expectedUrl = undefined;
            if (skinChangeResponse && skinChangeResponse.skins && skinChangeResponse.skins.length > 0) {
                expectedUrl = skinChangeResponse.skins[0].url;
            }
            const data = await this.getSkinDataWithRetry(account, type, expectedUrl, options.breadcrumb);
            if (expectedUrl && expectedUrl !== data.decodedValue!.textures!.SKIN!.url) {
                Discord.postDiscordMessage("⚠ URL mismatch\n" +
                    "  Server:       " + config.server + "\n" +
                    "  Account:      " + account.id + "/" + account.uuid + "\n" +
                    "  Changed to:   " + skinChangeResponse.skins[0].url + "\n" +
                    "  Texture Data: " + data.decodedValue!.textures!.SKIN!.url);
                account.forcedTimeoutAt = Math.floor(Date.now() / 1000);
                account.errorCounter++;
                account.totalErrorCounter++;
                AuditLogBuilder.create()
                    .context('account')
                    .action('inc_errors')
                    .resource('account', account.uuid)
                    .meta({
                        reason: 'url_mismatch',
                        errorCounter: account.errorCounter,
                        breadcrumb: options.breadcrumbId
                    })
                    .insert();
                console.warn(warn(options.breadcrumb + " [Generator] Account #" + account.id + " forced timeout (url mismatch)"));
                console.debug(JSON.stringify(skinChangeResponse));
                AuditLogBuilder.create()
                    .context('account')
                    .action('url_mismatch')
                    .resource('account', account.uuid)
                    .meta({
                        changedTo: skinChangeResponse.skins[0].url,
                        textureData: data.decodedValue!.textures!.SKIN!.url,
                        breadcrumb: options.breadcrumbId
                    })
                    .insert();
            }
            const mojangHash = await this.getMojangHash(data.decodedValue!.textures!.SKIN!.url, options);

            const hashesMatch = await this.compareImageAndMojangHash(tempFileValidation.hash!, mojangHash!.hash!, type, options, account);
            if (!hashesMatch) {
                // Discord.postDiscordMessageWithAttachment("⚠ Hash mismatch\n" +
                //     "  Server: " + config.server + "\n" +
                //     "  Account: " + account.id + "/" + account.uuid + "\n" +
                //     "  Image:  " + tempFileValidation.hash + "\n" +
                //     "  Mojang: " + mojangHash.hash + "\n" +
                //     "  Expected: " + expectedUrl + "\n" +
                //     "  Got: " + data.decodedValue!.textures!.SKIN!.url + "\n" +
                //     "  Account's Last URL: " + account.lastTextureUrl,
                //     tempFileValidation!.buffer!, "image.png");
                console.log(skinChangeResponse);
                //TODO: maybe retry getting the skin data if the urls don't match
            }

            account.lastTextureUrl = data.decodedValue!.textures!.SKIN!.url;

            await this.handleGenerateSuccess(type, options, client, account);

            return {
                data: data,
                account: account,
                meta: {
                    uuid: randomUuid(),
                    imageHash: tempFileValidation.hash!,
                    mojangHash: mojangHash!.hash!,
                    minecraftSkinId: minecraftSkinId
                }
            };
        })
    }

    /// GENERATE USER

    public static async generateFromUserAndSave(user: string, options: GenerateOptions, client: ClientInfo): Promise<SavedSkin> {
        const start = Date.now();
        const data = await this.generateFromUser(user, options, client);
        const skin = await this.getDuplicateOrSaved(data, options, client, GenerateType.USER, start);
        const end = Date.now();
        const metrics = container.get<MineSkinMetrics>(CoreTypes.MetricsProvider);
        metrics.durationMetric(end - start, GenerateType.USER, skin.duplicate);
        return skin;
    }

    protected static async generateFromUser(uuid: string, options: GenerateOptions, client: ClientInfo): Promise<GenerateResult> {
        console.log(info(options.breadcrumb + " [Generator] Generating from user"));
        Sentry.setExtra("generate_user", uuid);

        return await Sentry.startSpan({
            op: "generate_generateFromUser",
            name: "generateFromUser"
        }, async span => {

            const uuids = longAndShortUuid(uuid)!;
            const uuidDuplicate = await this.findDuplicateFromUuid(uuids.long, options, GenerateType.USER);
            if (uuidDuplicate) {
                return {
                    duplicate: uuidDuplicate
                };
            }

            const data = await this.getSkinData({
                uuid: uuids.short
            });
            const mojangHash = await this.getMojangHash(data.decodedValue!.textures!.SKIN!.url, options);

            const hashDuplicate = await this.findDuplicateFromImageHash(mojangHash!.hash!, options, client, GenerateType.USER);
            if (hashDuplicate) {
                return {
                    duplicate: hashDuplicate
                };
            }

            return {
                data: data,
                meta: {
                    uuid: uuids.long,
                    imageHash: mojangHash!.hash!,
                    mojangHash: mojangHash!.hash!
                }
            };
        })

    }

    /// AUTH

    protected static async getAndAuthenticateAccount(bread?: Bread): Promise<IAccountDocument> {
        return await Sentry.startSpan({
            op: "generate_getAndAuthenticateAccount",
            name: "getAndAuthenticateAccount"
        }, async span => {
            const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
            let account = await Accounts.findUsable(bread);
            if (!account) {
                console.warn(error(bread?.breadcrumb + " [Generator] No account available!"));
                metrics.getMetric('no_accounts')
                    .tag('server', HOSTNAME)
                    .inc();
                span?.setStatus({
                    code: 2,
                    message: "internal_error"
                });
                throw new GeneratorError(GenError.NO_ACCOUNT_AVAILABLE, "No account available");
            }
            Sentry.setTag("account", account.id);
            Sentry.setTag("account_type", account.accountType);
            account = await Authentication.authenticate(account, bread);

            account.lastUsed = Math.floor(Date.now() / 1000);
            if (!account.requestServer || !(await Generator.getRequestServers()).includes(account.requestServer)) {
                Accounts.updateAccountRequestServer(account, HOSTNAME)
            }

            return account;
        })


    }

    protected static async clearCape(account: IAccountDocument): Promise<boolean> {
        console.log(info(`Clearing cape of ${ account.id }/${ account.uuid }`));
        return Requests.dynamicRequestWithAccount(MINECRAFT_SERVICES_PROFILE, {
            method: "DELETE",
            url: "/minecraft/profile/capes/active",
            headers: {
                Authorization: `Bearer ${ account.accessToken }`
            }
        }, account).then(res => res.status === 200);
    }

    protected static async claim15YearCape(account: IAccountDocument): Promise<boolean> {
        console.log(info(`Claiming 15 year cape for ${ account.id }/${ account.uuid }`));
        return Requests.dynamicRequestWithAccount(MINECRAFT_SERVICES_PROFILE, {
            method: "POST",
            url: "/minecraft/cape/15year",
            headers: {
                Authorization: `Bearer ${ account.accessToken }`
            }
        }, account).then(res => res.status === 200);
    }

    protected static async clearCapeIfRequired(account: IAccountDocument): Promise<boolean> {
        if (!account.accessToken) return true;
        const profile = await Caching.getProfileByAccessToken(account.accessToken);
        let clearResult;
        let has15YearCape = false;
        if (profile && profile.capes && profile.capes.length > 0) {
            let ownedIds: string[] = [];
            for (let cape of profile.capes) {
                ownedIds.push(cape.id);
                if (cape.state === "ACTIVE") {
                    clearResult = await this.clearCape(account);
                }
                if (cape.id === Capes.ANNIVERSARY_15) {
                    has15YearCape = true;
                }
            }
            account.ownedCapes = ownedIds;
        }
        /*if (!has15YearCape) {
            // auto claim 15 year cape
            let claimed = await this.claim15YearCape(account);
            if (claimed) {
                account.ownedCapes?.push(Capes.ANNIVERSARY_15);
                console.log(info(`Claimed 15 year cape for ${ account.id }/${ account.uuid }`));
            }
        }*/
        if (clearResult) {
            return clearResult;
        }
        return true;
    }

    /// SUCCESS / ERROR HANDLERS
    private static GenError: any;

    protected static async handleGenerateSuccess(type: GenerateType, options: GenerateOptions, client: ClientInfo, account: IAccountDocument): Promise<void> {
        const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
        console.log(info(options.breadcrumb + "   ==> SUCCESS"));
        metrics.getMetric('generate_success')
            .tag("server", HOSTNAME)
            .tag("type", type)
            .tag("visibility", options.visibility === SkinVisibility.PRIVATE ? "private" : options.visibility === SkinVisibility.UNLISTED ? "unlisted" : "public") //FIXME
            .tag("variant", options.variant)
            .inc();
        metrics.getMetric('generate_clients')
            .tag("state", "success")
            .tag("type", type)
            .tag("visibility", options.visibility === SkinVisibility.PRIVATE ? "private" : options.visibility === SkinVisibility.UNLISTED ? "unlisted" : "public") //FIXME
            .tag("variant", options.variant)
            .tag("userAgent", client.userAgent.ua)
            .tag("apiKey", client.apiKey || "none")
            .tag("apiKeyId", client.apiKeyId || "none")
            .inc();
        metrics.getMetric('generate_accounts')
            .tag("state", "success")
            .tag("account", account.uuid)
            .inc();
        //TODO: remove
        metrics.getMetric('generate_success_fail')
            .tag("state", "success")
            .tag("server", HOSTNAME)
            .tag("type", type)
            .tag("visibility", options.visibility === SkinVisibility.UNLISTED ? "unlisted" : "public") //FIXME
            .tag("variant", options.variant)
            .tag("via", client.via)
            .tag("userAgent", client.userAgent.ua)
            .tag("account", account.id)
            .tag("accountType", account.accountType || "unknown")
            .tag("apiKey", client.apiKey || "none")
            .tag("genEnv", "api")
            .inc();

        await Stat.inc(GENERATE_SUCCESS);

        const redis = container.get<IRedisProvider>(CoreTypes.RedisProvider);
        let trans = redis.client.multi()
            .incr("mineskin:generated:total:success");
        if (account) {
            trans = trans.set(`mineskin:generated:accounts:${ account.uuid }:success`, `${ account.totalSuccessCounter || 0 }`, {NX: true})
                .incr(`mineskin:generated:accounts:${ account.uuid }:success`);
        }
        await trans.exec();

        if (!account) return;
        try {
            account.errorCounter = 0;
            account.successCounter++;
            account.totalSuccessCounter++;
            account.lastGenerateSuccess = Math.floor(Date.now() / 1000);
            await account.save();
        } catch (e1) {
            Sentry.captureException(e1);
        }
    }

    protected static async handleGenerateError(e: any, type: GenerateType, options: GenerateOptions, client: ClientInfo, account?: IAccountDocument): Promise<void> {
        const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
        if (e instanceof GeneratorError) {
            if (e.code == GenError.NO_DUPLICATE) {
                return;
            }
        }

        console.log(error(options.breadcrumb + "   ==> FAIL"));

        if (!account) {
            if (e instanceof AuthenticationError || e instanceof GeneratorError) {
                account = e.meta?.account;
            }
        }

        await Stat.inc(GENERATE_FAIL);
        const redis = container.get<IRedisProvider>(CoreTypes.RedisProvider);
        await redis.client.incr("mineskin:generated:total:fail");

        metrics.getMetric('generate_fail')
            .tag("server", HOSTNAME)
            .tag("type", type)
            .tag("visibility", options.visibility === SkinVisibility.PRIVATE ? "private" : options.visibility === SkinVisibility.UNLISTED ? "unlisted" : "public") //FIXME
            .tag("variant", options.variant)
            .tag("error", e instanceof MineSkinError ? e.code : e.name)
            .inc();
        metrics.getMetric('generate_clients')
            .tag("state", "fail")
            .tag("type", type)
            .tag("visibility", options.visibility === SkinVisibility.PRIVATE ? "private" : options.visibility === SkinVisibility.UNLISTED ? "unlisted" : "public") //FIXME
            .tag("variant", options.variant)
            .tag("userAgent", client.userAgent.ua)
            .tag("apiKey", client.apiKey || "none")
            .tag("apiKeyId", client.apiKeyId || "none")
            .inc();
        if (account) {
            metrics.getMetric('generate_accounts')
                .tag("state", "fail")
                .tag("account", account.uuid)
                .inc();
        }
        //TODO: remove
        let m = metrics.getMetric('generate_success_fail')
            .tag("state", "fail")
            .tag("server", HOSTNAME)
            .tag("type", type)
            .tag("visibility", options.visibility === SkinVisibility.UNLISTED ? "unlisted" : "public") //FIXME
            .tag("variant", options.variant)
            .tag("userAgent", client.userAgent.ua)
            .tag("apiKey", client.apiKey || "none")
            .tag("via", client.via)
            .tag("genEnv", "api");
        if (e instanceof MineSkinError) {
            m.tag("error", e.code);
        } else {
            m.tag("error", e.name);
        }
        m.inc();
        if (account) {
            try {
                account.successCounter = 0;
                if (!(e instanceof GeneratorError)) {
                    account.errorCounter++;
                }
                account.totalErrorCounter++;
                account.lastErrorCode = e.code;
                account.lastErrorMessage = e.message;
                if (e instanceof AuthenticationError) {
                    account.forcedTimeoutAt = Math.floor(Date.now() / 1000);
                    console.warn(warn(options.breadcrumb + " [Generator] Account #" + account.id + " forced timeout (auth error)"));
                    Accounts.updateAccountRequestServer(account, null);
                }
                if (e.message?.includes('429')) { //TODO: make this less shit
                    account.forcedTimeoutAt = Math.floor(Date.now() / 1000);
                    console.warn(warn(options.breadcrumb + " [Generator] Account #" + account.id + " forced timeout (429)"));
                    Accounts.updateAccountRequestServer(account, null);
                    Discord.postDiscordMessage(`Account #${ account.id } forced timeout due to 429: ${ e.message }`);
                }

                if (account.errorCounter > 0 && account.errorCounter % 10 === 0) {
                    Notifications.notifyHighErrorCount(account, type, e);
                }

                await account.save();

                if (account.user) {
                    Accounts.updateUserMinecraftAccounts(account.user);
                }
            } catch (e1) {
                Sentry.captureException(e1);
            }
        }
    }


    /// VALIDATION

    protected static getUrlFromResponse(response: AxiosResponse, originalUrl: string): string {
        return response.request.res.responseUrl || originalUrl; // the axios one may be null if the request was never redirected
    }

    protected static getSizeFromResponse(response: AxiosResponse): number {
        return response.headers["content-length"];
    }

    protected static getContentTypeFromResponse(response: AxiosResponse): string {
        return response.headers["content-type"];
    }

    protected static async validateTempFile(path: string, options: GenerateOptions, client: ClientInfo, type: GenerateType): Promise<TempFileValidationResult> {
        return await Sentry.startSpan({
            op: "generate_validateTempFile",
            name: "validateTempFile"
        }, async span => {
            // Validate downloaded image file
            const imageBuffer = await fs.readFile(path);
            const size = imageBuffer.byteLength;
            Sentry.setExtra("generate_filesize", size);
            if (!size || size < 100 || size > MAX_IMAGE_SIZE) {
                span?.setStatus({
                    code: 2,
                    message: "invalid_argument"
                });
                throw new GeneratorError(GenError.INVALID_IMAGE, `Invalid file size (${ size })`, {httpCode: 400});
            }

            let fType;
            try {
                fType = await fileType.fromBuffer(imageBuffer);
            } catch (e) {
                span?.setStatus({
                    code: 2,
                    message: "invalid_argument"
                });
                throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to determine file type", {
                    httpCode: 400,
                    error: e
                });
            }
            Sentry.setExtra("generate_mime", fType?.mime)
            if (!fType || !fType.mime.startsWith("image") || !ALLOWED_IMAGE_TYPES.includes(fType.mime)) {
                span?.setStatus({
                    code: 2,
                    message: "invalid_argument"
                });
                throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid file type: " + fType?.mime, {httpCode: 400});
            }

            let dimensions;
            try {
                dimensions = imageSize(imageBuffer);
            } catch (e) {
                span?.setStatus({
                    code: 2,
                    message: "invalid_argument"
                });
                throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to determine image dimensions", {
                    httpCode: 400,
                    error: e
                });
            }
            Sentry.setExtra("generate_dimensions", `${ dimensions.width }x${ dimensions.height }`);
            if ((dimensions.width !== 64) || (dimensions.height !== 64 && dimensions.height !== 32)) {
                span?.setStatus({
                    code: 2,
                    message: "invalid_argument"
                });
                throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image dimensions. Must be 64x32 or 64x64 (Were " + dimensions.width + "x" + dimensions.height + ")", {httpCode: 400});
            }

            // Get the imageHash
            let imageHash;
            try {
                imageHash = await imgHash(imageBuffer);
            } catch (e) {
                span?.setStatus({
                    code: 2,
                    message: "invalid_argument"
                });
                throw new GeneratorError(GenError.INVALID_IMAGE, `Failed to get image hash: ${ e.message }`, {
                    httpCode: 400, error: e
                });
            }
            console.log(debug(options.breadcrumb + " Image hash: " + imageHash));
            // Check duplicate from imageHash
            const hashDuplicate = await this.findDuplicateFromImageHash(imageHash, options, client, type);
            if (hashDuplicate) {
                return {
                    duplicate: hashDuplicate
                };
            }

            try {
                const dataValidation = await this.validateImageData(imageBuffer);
                if (options.variant === SkinVariant.UNKNOWN && dataValidation.variant !== SkinVariant.UNKNOWN) {
                    console.log(debug(options.breadcrumb + " Switching unknown skin variant to " + dataValidation.variant + " from detection"));
                    options.variant = dataValidation.variant;
                    options.model = dataValidation.model;
                    Sentry.setExtra("generate_detected_variant", dataValidation.variant);
                }
            } catch (e) {
                span?.setStatus({
                    code: 2,
                    message: "invalid_argument"
                });
                throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to validate image data", {
                    httpCode: 400,
                    error: e
                });
            }

            return {
                buffer: imageBuffer,
                size: size,
                dimensions: dimensions,
                fileType: fType,
                hash: imageHash
            };
        })


    }

    protected static decodeValue(data: ProfileSkinData): SkinValue {
        const decoded = JSON.parse(base64decode(data.value)) as SkinValue;
        data.decodedValue = decoded;
        return decoded;
    }

    public static async getMojangHash(url: string, options?: GenerateOptions, t = 2): Promise<MojangHashInfo> {
        return await Sentry.startSpan({
            op: "generate_getMojangHash",
            name: "getMojangHash"
        }, async span => {
            const tempFile = await Temp.file({
                dir: MOJ_DIR
            });
            try {
                await Temp.downloadImage(url, tempFile, options?.breadcrumb);
                const imageBuffer = await fs.readFile(tempFile.path);
                let fType: Maybe<FileTypeResult> = {mime: "image/png", ext: "png"};
                try {
                    fType = await fileType.fromBuffer(imageBuffer);
                } catch (e) {
                    Sentry.captureException(e);
                }
                const hash = await imgHash(imageBuffer);
                return {
                    buffer: imageBuffer,
                    hash: hash
                };
            } catch (e) {
                console.warn(warn("Failed to get hash from mojang skin " + url + " (" + t + ")"));
                if (t > 0) {
                    await sleep(100);
                    return await this.getMojangHash(url, options, t - 1);
                }
                throw e;
            } finally {
                if (tempFile) {
                    tempFile.remove();
                }
            }
        })


    }

    protected static async compareImageAndMojangHash(imageHash: string, mojangHash: string, type: GenerateType, options: GenerateOptions, account: IAccountDocument): Promise<boolean> {
        if (imageHash === mojangHash) {
            return true;
        }
        const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
        console.warn(warn(options.breadcrumb + " image hash does not match mojang hash (" + imageHash + " != " + mojangHash + ")"));
        metrics.getMetric('hash_mismatch')
            .tag('server', HOSTNAME)
            .tag('type', type)
            .tag('account', account.id)
            .inc();
        return false;
    }

    protected static async validateImageData(buffer: Buffer): Promise<ImageDataValidationResult> {
        return await Sentry.startSpan({
            op: "generate_validateImageData",
            name: "validateImageData"
        }, async span => {
            const image = await Jimp.read(buffer);
            const width = image.getWidth();
            const height = image.getHeight();
            if ((width !== 64) || (height !== 64 && height !== 32)) {
                span.setStatus({
                    code: 2,
                    message: "invalid_argument"
                });
                throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image dimensions. Must be 64x32 or 64x64 (Were " + width + "x" + height + ")", {httpCode: 400});
            }
            if (height < 64) {
                return {
                    model: SkinModel.CLASSIC,
                    variant: SkinVariant.CLASSIC
                };
            }
            // https://github.com/InventivetalentDev/MineRender/blob/master/src/skin/index.js#L146
            let allTransparent = true;
            image.scan(54, 20, 2, 12, function (x: number, y: number, idx: number) {
                let a = image.bitmap.data[idx + 3];
                if (a === 255) {
                    allTransparent = false;
                }
            });

            if (allTransparent) {
                return {
                    model: SkinModel.SLIM,
                    variant: SkinVariant.SLIM
                };
            } else {
                return {
                    model: SkinModel.CLASSIC,
                    variant: SkinVariant.CLASSIC
                }
            }
        })


    }

    static appendOptionsToDuplicateQuery(options: GenerateOptions, query: any): any {
        if (options) {
            if (options.model && options.model !== SkinModel.UNKNOWN) {
                query.model = options.model;
            } else if (options.variant && options.variant !== SkinVariant.UNKNOWN) {
                query.variant = options.variant;
            }
        }
        return query;
    }


}

export class SavedSkin {
    constructor(public readonly skin: ISkinDocument, public readonly duplicate: boolean) {
    }

    async toResponseJson(delayInfo?: DelayInfo): Promise<SkinInfo> {
        const info = await this.skin.toResponseJson();
        info.duplicate = this.duplicate;
        if (delayInfo) {
            info.nextRequest = Math.round(delayInfo.seconds); // deprecated

            info.delayInfo = {
                millis: delayInfo.millis,
                seconds: delayInfo.seconds
            }
        }
        return info;
    }
}

interface GenerateResult {
    duplicate?: ISkinDocument;
    data?: ProfileSkinData;
    meta?: SkinMeta;
    account?: IAccountDocument;
}

interface TempFileValidationResult extends GenerateResult {
    buffer?: Buffer;
    size?: number;
    dimensions?: ISizeCalculationResult;
    fileType?: FileTypeResult;
    hash?: string;
}

interface MojangHashInfo {
    buffer?: Buffer;
    hash?: string;
}

interface ImageDataValidationResult {
    model: SkinModel;
    variant: SkinVariant;
}

interface SkinChangeResponse {
    id: string;
    name: string;
    skins: SkinChangeSkin[];
    capes: any[];
}

interface SkinChangeSkin {
    id: string;
    state: string;
    url: string;
}

export enum DuplicateSource {
    MINESKIN_URL = "mineskin_url",
    TEXTURE_URL = "texture_url",
    IMAGE_HASH = "image_hash",
    USER_UUID = "user_uuid"
}

