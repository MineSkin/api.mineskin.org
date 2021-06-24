import { Account, Skin, Stat } from "../database/schemas";
import { MemoizeExpiring } from "@inventivetalent/typescript-memoize";
import { base64decode, getHashFromMojangTextureUrl, hasOwnProperty, imgHash, longAndShortUuid, Maybe, random32BitNumber, stripUuid } from "../util";
import { Caching } from "./Caching";
import { Authentication, AuthenticationError } from "./Authentication";
import * as Sentry from "@sentry/node";
import { Severity } from "@sentry/node";
import { Requests } from "./Requests";
import * as FormData from "form-data";
import { URL } from "url";
import { MOJ_DIR, Temp, TempFile, UPL_DIR, URL_DIR } from "./Temp";
import { AxiosResponse } from "axios";
import imageSize from "image-size";
import { promises as fs } from "fs";
import * as fileType from "file-type";
import { FileTypeResult } from "file-type";
import { UploadedFile } from "express-fileupload";
import { ISizeCalculationResult } from "image-size/dist/types/interface";
import { v4 as randomUuid } from "uuid";
import * as Jimp from "jimp";
import { getConfig } from "../typings/Configs";
import { IAccountDocument, ISkinDocument, IStatDocument, MineSkinError } from "../typings";
import { SkinData, SkinMeta, SkinValue } from "../typings/SkinData";
import { GenerateOptions } from "../typings/GenerateOptions";
import { GenerateType, SkinModel, SkinVariant, SkinVisibility } from "../typings/db/ISkinDocument";
import { AccountStats, CountDuplicateViewStats, DurationStats, Stats, SuccessRateStats, TimeFrameStats } from "../typings/Stats";
import { ClientInfo } from "../typings/ClientInfo";
import { debug, error, info, warn } from "../util/colors";
import { SkinInfo } from "../typings/SkinInfo";
import { Bread } from "../typings/Bread";
import { IPoint } from "influx";
import { Notifications } from "../util/Notifications";
import { IApiKeyDocument } from "../typings/db/IApiKeyDocument";
import stripUserAgent from "user-agent-stripper";
import { MineSkinMetrics } from "../util/metrics";
import { MineSkinOptimus } from "../util/optimus";


// minimum delay for accounts to be used - don't set lower than 60
export const MIN_ACCOUNT_DELAY = 80;

const MAX_ID_TRIES = 10;

const MINESKIN_URL_REGEX = /https?:\/\/minesk(\.in|in\.org)\/([0-9]+)/i;
const MINECRAFT_TEXTURE_REGEX = /https?:\/\/textures\.minecraft\.net\/texture\/([0-9a-z]+)/i;

const URL_REWRITES = new Map<RegExp, string>([
    [/https?:\/\/imgur\.com\/(.+)/, 'https://i.imgur.com/$1.png'],
    [/https?:\/\/.+namemc\.com\/skin\/(.+)/, 'https://namemc.com/texture/$1.png'],
    [/https?:\/\/.+minecraftskins\.com\/skin\/(\d+)\/.+/, 'https://www.minecraftskins.com/skin/download/$1'],
    [/https?:\/\/minecraft\.novaskin\.me\/skin\/(\d+)\/.+/, 'https://minecraft.novaskin.me/skin/$1/download']
]);

const URL_FOLLOW_WHITELIST = [
    "novask.in",
    "imgur.com",
    "i.imgur.com"
];
const MAX_FOLLOW_REDIRECTS = 5;

const MAX_IMAGE_SIZE = 20000; // 20KB - about 70x70px at 32bit
const ALLOWED_IMAGE_TYPES = ["image/png"];

export const HASH_VERSION = 4;

export class Generator {

    protected static accountStats: AccountStats;
    protected static durationStats: DurationStats;
    protected static successRateStats: SuccessRateStats;
    protected static countDuplicateViewStats: CountDuplicateViewStats;
    protected static timeFrameStats: TimeFrameStats;

    protected static detailedStatsQueryTimer = setInterval(() => Generator.queryDetailedStats(), 120000);

    static async getDelay(apiKey?: IApiKeyDocument): Promise<number> {
        const config = await getConfig();
        const minDelay = await this.getMinDelay();
        if (!apiKey) {
            return Math.max(config.delays.default, minDelay);
        }
        return Math.max(Math.min(config.delays.default, apiKey.minDelay), minDelay);
    }

    @MemoizeExpiring(30000)
    static async getMinDelay(): Promise<number> {
        const metrics = await MineSkinMetrics.get();
        const delay = await Account.calculateMinDelay();
        try {
            metrics.metrics!.influx.writePoints([{
                measurement: 'delay',
                fields: {
                    delay: delay
                }
            }], {
                database: 'mineskin'
            })
        } catch (e) {
            Sentry.captureException(e);
        }
        return Math.round(delay);
    }

    @MemoizeExpiring(30000)
    static async getPreferredAccountServer(): Promise<string> {
        const config = await getConfig();
        return await Account.getPreferredAccountServer() || config.server;
    }

    // Stats

    @MemoizeExpiring(60000)
    static async getStats(): Promise<Stats> {
        const config = await getConfig();
        const delay = await this.getMinDelay();

        const stats = <Stats>{
            server: config.server,
            delay: delay
        };
        if (this.accountStats) {
            stats.accounts = this.accountStats.accounts;
            stats.serverAccounts = this.accountStats.serverAccounts;
            stats.healthyAccounts = this.accountStats.healthyAccounts;
            stats.useableAccounts = this.accountStats.useableAccounts;
        }
        if (this.successRateStats) {
            const generateTotal = this.successRateStats.generateSuccess + this.successRateStats.generateFail;
            stats.successRate = Number((this.successRateStats.generateSuccess / generateTotal).toFixed(3));
            const testerTotal = this.successRateStats.testerSuccess + this.successRateStats.testerFail;
            stats.mineskinTesterSuccessRate = Number((this.successRateStats.testerSuccess / testerTotal).toFixed(3));
        }
        if (this.durationStats) {
            stats.avgGenerateDuration = this.durationStats.avgGenerateDuration;
        }
        if (this.countDuplicateViewStats) {
            stats.genUpload = this.countDuplicateViewStats.genUpload;
            stats.genUrl = this.countDuplicateViewStats.genUrl;
            stats.genUser = this.countDuplicateViewStats.genUser;

            stats.unique = this.countDuplicateViewStats.unique || 0;
            stats.duplicate = this.countDuplicateViewStats.duplicate || 0;
            stats.views = this.countDuplicateViewStats.views || 0;

            stats.total = stats.unique + stats.duplicate;
        }
        if (this.timeFrameStats) {
            stats.lastYear = this.timeFrameStats.lastYear;
            stats.lastMonth = this.timeFrameStats.lastMonth;
            stats.lastDay = this.timeFrameStats.lastDay;
            stats.lastHour = this.timeFrameStats.lastHour;
        }
        return stats;
    }

    protected static async queryDetailedStats(): Promise<void> {
        const metrics = await MineSkinMetrics.get();

        this.accountStats = await this.queryAccountStats();
        this.durationStats = await this.queryDurationStats();
        this.successRateStats = await this.querySuccessRateStats();
        this.countDuplicateViewStats = await this.queryCountDuplicateViewStats();
        this.timeFrameStats = await this.queryTimeFrameStats();

        try {
            await metrics.metrics!.influx.writePoints([
                {
                    measurement: 'accounts',
                    tags: {
                        server: metrics.config.server
                    },
                    fields: {
                        total: this.accountStats.accounts,
                        totalServer: this.accountStats.serverAccounts,
                        healthy: this.accountStats.healthyAccounts,
                        useable: this.accountStats.useableAccounts
                    }
                },
                {
                    measurement: 'skins',
                    fields: {
                        total: (this.countDuplicateViewStats.unique || 0) + (this.countDuplicateViewStats.duplicate || 0),
                        unique: this.countDuplicateViewStats.unique || 0,
                        duplicate: this.countDuplicateViewStats.duplicate || 0
                    }
                }
            ], {
                database: 'mineskin'
            })

            let accountsPerTypePoints: IPoint[] = [];
            for (let accountType in this.accountStats.accountTypes) {
                accountsPerTypePoints.push({
                    measurement: 'account_types',
                    tags: {
                        server: metrics.config.server,
                        type: accountType
                    },
                    fields: {
                        count: this.accountStats.accountTypes[accountType]
                    }
                })
            }
            await metrics.metrics!.influx.writePoints(accountsPerTypePoints, {
                database: 'mineskin'
            })
        } catch (e) {
            console.warn(e);
            Sentry.captureException(e);
        }
    }

    protected static async queryAccountStats(): Promise<AccountStats> {
        const config = await getConfig();
        const time = Date.now() / 1000;

        const enabledAccounts = await Account.countDocuments({
            enabled: true
        }).exec();
        const serverAccounts = await Account.countDocuments({
            enabled: true,
            requestServer: config.server
        }).exec();
        const healthyAccounts = await Account.countGlobalUsable();
        const useableAccounts = await Account.countDocuments({
            enabled: true,
            requestServer: { $in: ["default", config.server] },
            lastUsed: { '$lt': (time - MIN_ACCOUNT_DELAY) },
            forcedTimeoutAt: { '$lt': (time - 500) },
            errorCounter: { '$lt': (config.errorThreshold || 10) },
            timeAdded: { $lt: (time - 60) }
        }).exec();
        const accountTypes = await Account.aggregate([
            {
                "$match": {
                    requestServer: { $in: ["default", config.server] }
                }
            }, {
                "$group":
                    {
                        _id: "$accountType",
                        count: { $sum: 1 }
                    }
            }
        ]).exec().then((res: any[]) => {
            let counts: { [type: string]: number; } = {};
            res.forEach(e => {
                counts[e["_id"]] = e["count"];
            })
            return counts;
        });

        return {
            accounts: enabledAccounts,
            serverAccounts,
            healthyAccounts,
            useableAccounts,
            accountTypes
        };
    }

    protected static async queryDurationStats(): Promise<DurationStats> {
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
            return <DurationStats>{
                avgGenerateDuration: res[0]["avgGenTime"] as number
            };
        });
    }

    protected static async querySuccessRateStats(): Promise<SuccessRateStats> {
        const rawStats = await Stat.find({}).lean().exec();
        const stats: SuccessRateStats = {
            generateSuccess: 0,
            generateFail: 0,
            testerSuccess: 0,
            testerFail: 0
        };
        rawStats.forEach((stat: IStatDocument) => {
            switch (stat.key) {
                case "generate.success":
                    stats.generateSuccess = stat.value;
                    break;
                case "generate.fail":
                    stats.generateFail = stat.value;
                    break;
                case "mineskintester.success":
                    stats.testerSuccess = stat.value;
                    break;
                case "mineskintester.fail":
                    stats.testerFail = stat.value;
                    break;
            }
        });
        return stats;
    }

    protected static async queryCountDuplicateViewStats(): Promise<CountDuplicateViewStats> {
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
        ]).exec().then((res: any[]) => {
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
            stats.unique = stats.genUpload + stats.genUrl + stats.genUser;
            stats.duplicate = stats.duplicateUpload + stats.duplicateUrl + stats.duplicateUser;
            stats.views = stats.viewsUpload + stats.viewsUrl + stats.viewsUser;
            return stats;
        });
    }

    protected static async queryTimeFrameStats(): Promise<TimeFrameStats> {
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
            return <TimeFrameStats>{
                lastYear: res[0]["lastYear"] as number,
                lastMonth: res[0]["lastMonth"] as number,
                lastDay: res[0]["lastDay"] as number,
                lastHour: res[0]["lastHour"] as number
            }
        })
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
        const existing = await Skin.findOne({ id: newId }, "id").lean().exec();
        if (existing && existing.hasOwnProperty("id")) {
            return this.makeRandomSkinId(tryN + 1);
        }
        return newId;
    }


    static async getSkinData(accountOrUuid: IAccountDocument | { uuid: string }): Promise<SkinData> {
        const uuid = stripUuid(accountOrUuid.uuid);
        const data = await Caching.getSkinData(uuid);
        if (!data || !data.value) {
            throw new GeneratorError(GenError.INVALID_SKIN_DATA, "Skin data was invalid", 500, hasOwnProperty(accountOrUuid, "id") ? accountOrUuid as IAccountDocument : undefined, data);
        }
        const decodedValue = this.decodeValue(data);
        if (!decodedValue || !decodedValue.textures || !decodedValue.textures.SKIN) {
            throw new GeneratorError(GenError.INVALID_SKIN_DATA, "Skin data has no skin info", 500, hasOwnProperty(accountOrUuid, "id") ? accountOrUuid as IAccountDocument : undefined, data);
        }
        return data;
    }


    protected static async saveSkin(result: GenerateResult, options: GenerateOptions, client: ClientInfo, type: GenerateType, start: number): Promise<ISkinDocument> {
        const config = await getConfig();
        const id = await this.makeNewSkinId();
        const skinUuid = stripUuid(randomUuid());
        const time = Date.now();
        const duration = time - start;
        const skin: ISkinDocument = new Skin(<ISkinDocument>{
            id: id,
            skinUuid: skinUuid,

            hash: result.meta?.imageHash,
            uuid: result.meta?.uuid,

            name: options.name,
            model: options.model,
            variant: options.variant,
            visibility: options.visibility,

            value: result.data!.value,
            signature: result.data!.signature,
            url: result.data!.decodedValue!.textures!.SKIN!.url!,
            minecraftTextureHash: getHashFromMojangTextureUrl(result.data!.decodedValue!.textures.SKIN!.url!),
            textureHash: result.meta?.mojangHash,
            minecraftSkinId: result.meta?.minecraftSkinId,

            time: (time / 1000),
            generateDuration: duration,

            account: result.account?.id,
            breadcrumb: options.breadcrumb,
            type: type,
            server: config.server,

            via: client.via,
            ua: client.userAgent,
            apiKey: client.apiKey,

            duplicate: 0,
            views: 0,
            hv: HASH_VERSION
        })
        return skin.save().then(skin => {
            console.log(info(options.breadcrumb + " New skin saved #" + skin.id + " - generated in " + duration + "ms by " + result.account?.getAccountType() + " account #" + result.account?.id));
            return skin;
        })
    }

    protected static async getDuplicateOrSaved(result: GenerateResult, options: GenerateOptions, client: ClientInfo, type: GenerateType, start: number): Promise<SavedSkin> {
        const metrics = await MineSkinMetrics.get();
        if (result.duplicate) {
            return new SavedSkin(result.duplicate, true);
        }
        if (result.data) {
            try {
                metrics.newDuplicate
                    .tag("newOrDuplicate", "new")
                    .tag("server", metrics.config.server)
                    .tag("type", type)
                    .inc();
            } catch (e) {
                Sentry.captureException(e);
            }
            const doc = await this.saveSkin(result, options, client, type, start)
            return new SavedSkin(doc, false);
        }
        // shouldn't ever get here
        throw new MineSkinError('unknown', "Something went wrong while generating");
    }

    /// DUPLICATE CHECKS

    protected static async findDuplicateFromUrl(url: string, options: GenerateOptions, type: GenerateType): Promise<Maybe<ISkinDocument>> {
        const metrics = await MineSkinMetrics.get();
        if (!url || url.length < 8 || !url.startsWith("http")) {
            return undefined;
        }

        const mineskinUrlResult = MINESKIN_URL_REGEX.exec(url);
        if (!!mineskinUrlResult && mineskinUrlResult.length >= 3) {
            const mineskinId = parseInt(mineskinUrlResult[2]);
            const existingSkin = await Skin.findOne({
                id: mineskinId
            }).exec();
            if (existingSkin) {
                console.log(debug(options.breadcrumb + " Found existing skin from mineskin url"));
                existingSkin.duplicate++;
                try {
                    metrics.newDuplicate
                        .tag("newOrDuplicate", "duplicate")
                        .tag("server", metrics.config.server)
                        .tag("source", DuplicateSource.MINESKIN_URL)
                        .tag("type", type)
                        .inc();
                } catch (e) {
                    Sentry.captureException(e);
                }
                return await existingSkin.save();
            } else {
                return undefined;
            }
        }

        const minecraftTextureResult = MINECRAFT_TEXTURE_REGEX.exec(url);
        if (!!minecraftTextureResult && minecraftTextureResult.length >= 2) {
            const textureUrl = minecraftTextureResult[0];
            const textureHash = minecraftTextureResult[1];
            const existingSkin = await Skin.findOne({
                $or: [
                    { url: textureUrl },
                    { minecraftTextureHash: textureHash }
                ]
            });
            if (existingSkin) {
                console.log(debug(options.breadcrumb + " Found existing skin with same minecraft texture url/hash"));
                existingSkin.duplicate++;
                try {
                    metrics.newDuplicate
                        .tag("newOrDuplicate", "duplicate")
                        .tag("server", metrics.config.server)
                        .tag("source", DuplicateSource.TEXTURE_URL)
                        .tag("type", type)
                        .inc();
                } catch (e) {
                    Sentry.captureException(e);
                }
                return await existingSkin.save();
            } else {
                return undefined;
            }
        }

        return undefined;
    }

    protected static async findDuplicateFromImageHash(hash: string, options: GenerateOptions, client: ClientInfo, type: GenerateType): Promise<Maybe<ISkinDocument>> {
        const metrics = await MineSkinMetrics.get();
        if (!hash || hash.length < 30) {
            return undefined;
        }

        const query = {
            hash: hash
        };
        this.appendOptionsToDuplicateQuery(options, query);
        const existingSkin = await Skin.findOne(query).exec();
        if (existingSkin) {
            console.log(debug(options.breadcrumb + " Found existing skin with same image hash"));
            existingSkin.duplicate++;
            try {
                metrics.newDuplicate
                    .tag("newOrDuplicate", "duplicate")
                    .tag("server", metrics.config.server)
                    .tag("source", DuplicateSource.IMAGE_HASH)
                    .tag("type", type)
                    .tag("userAgent", stripUserAgent(client.userAgent))
                    .inc();
            } catch (e) {
                Sentry.captureException(e);
            }
            return await existingSkin.save();
        } else {
            return undefined;
        }
    }

    protected static async findDuplicateFromUuid(uuid: string, options: GenerateOptions, type: GenerateType): Promise<Maybe<ISkinDocument>> {
        const metrics = await MineSkinMetrics.get();
        if (!uuid || uuid.length < 34) {
            return undefined;
        }

        const time = Math.floor(Date.now() / 1000);
        const existingSkin = await Skin.findOne({
            uuid: uuid,
            name: options.name, visibility: options.visibility,
            time: { $gt: (time - 1800) } // Wait 30 minutes before generating again
        }).exec();
        if (existingSkin) {
            console.log(debug(options.breadcrumb + " Found existing skin for user"));
            existingSkin.duplicate++;
            try {
                metrics.newDuplicate
                    .tag("newOrDuplicate", "duplicate")
                    .tag("server", metrics.config.server)
                    .tag("source", DuplicateSource.USER_UUID)
                    .tag("type", type)
                    .inc();
            } catch (e) {
                Sentry.captureException(e);
            }
            return await existingSkin.save();
        } else {
            return undefined;
        }
    }

    /// GENERATE URL

    public static async generateFromUrlAndSave(url: string, options: GenerateOptions, client: ClientInfo): Promise<SavedSkin> {
        const start = Date.now();
        const data = await this.generateFromUrl(url, options, client);
        const skin = await this.getDuplicateOrSaved(data, options, client, GenerateType.URL, start);
        const end = Date.now();
        (await MineSkinMetrics.get()).durationMetric(end - start, GenerateType.URL, options, data.account);
        return skin;
    }

    protected static async generateFromUrl(originalUrl: string, options: GenerateOptions, client: ClientInfo): Promise<GenerateResult> {
        const metrics = await MineSkinMetrics.get();
        console.log(info(options.breadcrumb + " [Generator] Generating from url"));
        Sentry.setExtra("generate_url", originalUrl);

        try {
            metrics.urlHosts
                .tag('host', new URL(originalUrl).host)
                .inc();
        } catch (e) {
            Sentry.captureException(e);
        }

        let account: Maybe<IAccountDocument> = undefined;
        let tempFile: Maybe<TempFile> = undefined;
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
            const followResponse = await this.followUrl(originalUrl);
            if (!followResponse) {
                throw new GeneratorError(GenError.INVALID_IMAGE_URL, "Failed to find image from url", 400, undefined, originalUrl);
            }
            // Validate response headers
            const url = this.getUrlFromResponse(followResponse, originalUrl);
            if (!url) {
                throw new GeneratorError(GenError.INVALID_IMAGE_URL, "Failed to follow url", 400, undefined, originalUrl);
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
            }
            const contentType = this.getContentTypeFromResponse(followResponse);
            Sentry.setExtra("generate_contentType", contentType);
            if (!contentType || !contentType.startsWith("image") || !ALLOWED_IMAGE_TYPES.includes(contentType)) {
                throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image content type: " + contentType, 400, undefined, originalUrl);
            }
            const size = this.getSizeFromResponse(followResponse);
            Sentry.setExtra("generate_contentLength", size);
            if (!size || size < 100 || size > MAX_IMAGE_SIZE) {
                throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image file size", 400, undefined, originalUrl);
            }

            // Download the image temporarily
            tempFile = await Temp.file({
                dir: URL_DIR
            });
            try {
                await Temp.downloadImage(url, tempFile)
            } catch (e) {
                throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to download image", 500, undefined, e);
            }

            // Validate downloaded image file
            const tempFileValidation = await this.validateTempFile(tempFile, options, client, GenerateType.URL);
            if (tempFileValidation.duplicate) {
                // found a duplicate
                return tempFileValidation;
            }

            if (options.checkOnly) {
                throw new GeneratorError(GenError.NO_DUPLICATE, "No duplicate found", 404, undefined)
            }

            /// Run generation for new skin

            account = await this.getAndAuthenticateAccount(options);

            const body = {
                variant: options.variant,
                url: url
            };
            const skinResponse = await Requests.minecraftServicesRequest({
                method: "POST",
                url: "/minecraft/profile/skins",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": account.authenticationHeader()
                },
                data: body
            }).catch(err => {
                if (err.response) {
                    let msg = (err.response as AxiosResponse).data?.errorMessage ?? "Failed to change skin";
                    throw new GeneratorError(GenError.SKIN_CHANGE_FAILED, msg, (err.response as AxiosResponse).status, account, err);
                }
                throw err;
            });
            return this.handleSkinChangeResponse(skinResponse, GenerateType.URL, options, client, account, tempFileValidation);
        } catch (e) {
            await this.handleGenerateError(e, GenerateType.URL, options, client, account);
            throw e;
        } finally {
            if (tempFile) {
                tempFile.remove();
            }
        }

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

    protected static async followUrl(urlStr: string): Promise<Maybe<AxiosResponse>> {
        if (!urlStr) return undefined;
        try {
            const url = new URL(urlStr);
            if (!url.host || !url.pathname) {
                return undefined;
            }
            if (!url.protocol || (url.protocol !== "http:" && url.protocol !== "https:")) {
                return undefined;
            }
            const follow = URL_FOLLOW_WHITELIST.includes(url.host!);
            return await Requests.axiosInstance.request({
                method: "HEAD",
                url: url.href,
                maxRedirects: follow ? MAX_FOLLOW_REDIRECTS : 0,
                headers: {
                    "User-Agent": "MineSkin"
                }
            });
        } catch (e) {
            Sentry.captureException(e, {
                level: Severity.Warning
            });
        }
        return undefined;
    }


    /// GENERATE UPLOAD

    public static async generateFromUploadAndSave(file: UploadedFile, options: GenerateOptions, client: ClientInfo): Promise<SavedSkin> {
        const start = Date.now();
        const data = await this.generateFromUpload(file, options, client);
        const skin = await this.getDuplicateOrSaved(data, options, client, GenerateType.UPLOAD, start);
        const end = Date.now();
        (await MineSkinMetrics.get()).durationMetric(end - start, GenerateType.UPLOAD, options, data.account);
        return skin;
    }

    protected static async generateFromUpload(file: UploadedFile, options: GenerateOptions, client: ClientInfo): Promise<GenerateResult> {
        console.log(info(options.breadcrumb + " [Generator] Generating from upload"));
        Sentry.setExtra("generate_file", file.md5);

        let account: Maybe<IAccountDocument> = undefined;
        let tempFile: Maybe<TempFile> = undefined;
        try {
            // Copy uploaded file
            tempFile = await Temp.file({
                dir: UPL_DIR
            });
            try {
                await Temp.copyUploadedImage(file, tempFile);
            } catch (e) {
                throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to upload image", 500, undefined, e);
            }

            // Validate uploaded image file
            const tempFileValidation = await this.validateTempFile(tempFile, options, client, GenerateType.UPLOAD);
            if (tempFileValidation.duplicate) {
                // found a duplicate
                return tempFileValidation;
            }

            if (options.checkOnly) {
                throw new GeneratorError(GenError.NO_DUPLICATE, "No duplicate found", 404, undefined)
            }

            /// Run generation for new skin

            account = await this.getAndAuthenticateAccount(options);

            const body = new FormData();
            body.append("variant", options.variant);
            body.append("file", tempFileValidation.buffer!, {
                filename: "skin.png",
                contentType: "image/png"
            });
            const skinResponse = await Requests.minecraftServicesRequest({
                method: "POST",
                url: "/minecraft/profile/skins",
                headers: body.getHeaders({
                    "Authorization": account.authenticationHeader()
                }),
                data: body
            }).catch(err => {
                if (err.response) {
                    let msg = (err.response as AxiosResponse).data?.errorMessage ?? "Failed to change skin";
                    throw new GeneratorError(GenError.SKIN_CHANGE_FAILED, msg, (err.response as AxiosResponse).status, account, err);
                }
                throw err;
            });
            return this.handleSkinChangeResponse(skinResponse, GenerateType.UPLOAD, options, client, account, tempFileValidation);
        } catch (e) {
            await this.handleGenerateError(e, GenerateType.UPLOAD, options, client, account);
            throw e;
        } finally {
            if (tempFile) {
                tempFile.remove();
            }
        }
    }

    static async handleSkinChangeResponse(skinResponse: AxiosResponse, type: GenerateType, options: GenerateOptions, client: ClientInfo, account: IAccountDocument, tempFileValidation: TempFileValidationResult): Promise<GenerateResult> {
        const skinChangeResponse = skinResponse.data as SkinChangeResponse;
        const minecraftSkinId = skinChangeResponse?.skins[0]?.id;

        const data = await this.getSkinData(account);
        if (skinChangeResponse && skinChangeResponse.skins && skinChangeResponse.skins.length > 0) {
            if (skinChangeResponse.skins[0].url !== data.decodedValue!.textures!.SKIN!.url) {
                console.warn(warn(options.breadcrumb + " Skin url returned by skin change does not match url returned by data query (" + skinChangeResponse.skins[0].url + " != " + data.decodedValue!.textures!.SKIN!.url + ")"));
                //TODO: figure out why this happens

                // throw new MineSkinError("skin_url_mismatch", "Skin url returned by skin change does not match url returned by data query", 500);
            }
        }
        const mojangHash = await this.getMojangHash(data.decodedValue!.textures!.SKIN!.url);

        await this.compareImageAndMojangHash(tempFileValidation.hash!, mojangHash!.hash!, type, options, account);
        //TODO: compare actual image contents

        await this.handleGenerateSuccess(type, options, client, account);

        account.lastTextureUrl = data.decodedValue!.textures!.SKIN!.url;

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
    }

    /// GENERATE USER

    public static async generateFromUserAndSave(user: string, options: GenerateOptions, client: ClientInfo): Promise<SavedSkin> {
        const start = Date.now();
        const data = await this.generateFromUser(user, options);
        const skin = await this.getDuplicateOrSaved(data, options, client, GenerateType.USER, start);
        const end = Date.now();
        (await MineSkinMetrics.get()).durationMetric(end - start, GenerateType.USER, options, data.account);
        return skin;
    }

    protected static async generateFromUser(uuid: string, options: GenerateOptions): Promise<GenerateResult> {
        console.log(info(options.breadcrumb + " [Generator] Generating from user"));
        Sentry.setExtra("generate_user", uuid);

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
        const mojangHash = await this.getMojangHash(data.decodedValue!.textures!.SKIN!.url);

        return {
            data: data,
            meta: {
                uuid: uuids.long,
                imageHash: mojangHash!.hash!,
                mojangHash: mojangHash!.hash!
            }
        };
    }

    /// AUTH

    protected static async getAndAuthenticateAccount(bread?: Bread): Promise<IAccountDocument> {
        const metrics = await MineSkinMetrics.get();
        let account = await Account.findUsable(bread);
        if (!account) {
            console.warn(error(bread?.breadcrumb + " [Generator] No account available!"));
            metrics.noAccounts
                .tag('server', metrics.config.server)
                .inc();
            throw new GeneratorError(GenError.NO_ACCOUNT_AVAILABLE, "No account available");
        }
        Sentry.setTag("account", account.id);
        Sentry.setTag("account_type", account.getAccountType());
        account = await Authentication.authenticate(account, bread);

        account.lastUsed = Math.floor(Date.now() / 1000);
        account.updateRequestServer(metrics.config.server);

        return account;
    }

    /// SUCCESS / ERROR HANDLERS

    protected static async handleGenerateSuccess(type: GenerateType, options: GenerateOptions, client: ClientInfo, account: IAccountDocument): Promise<void> {
        const metrics = await MineSkinMetrics.get();
        console.log(info(options.breadcrumb + "   ==> SUCCESS"));
        metrics.successFail
            .tag("state", "success")
            .tag("server", metrics.config.server)
            .tag("type", type)
            .tag("visibility", options.visibility === SkinVisibility.PRIVATE ? "private" : "public")
            .tag("variant", options.variant)
            .tag("via", client.via)
            .tag("userAgent", stripUserAgent(client.userAgent))
            .tag("account", account.id)
            .tag("accountType", account.accountType || "unknown")
            .tag("apiKey", client.apiKey || "none")
            .inc();
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
        const metrics = await MineSkinMetrics.get();
        if (e instanceof GeneratorError) {
            if (e.code == GenError.NO_DUPLICATE) {
                return;
            }
        }

        console.log(error(options.breadcrumb + "   ==> FAIL"));

        if (!account) {
            if (e instanceof AuthenticationError || e instanceof GeneratorError) {
                account = e.account;
            }
        }

        let m = metrics.successFail
            .tag("state", "fail")
            .tag("server", metrics.config.server)
            .tag("type", type)
            .tag("visibility", options.visibility === SkinVisibility.PRIVATE ? "private" : "public")
            .tag("variant", options.variant)
            .tag("userAgent", stripUserAgent(client.userAgent))
            .tag("apiKey", client.apiKey || "none")
            .tag("via", client.via);
        if (account) {
            m.tag("account", account.id)
                .tag("accountType", account.accountType || "unknown")
        }
        if (e instanceof MineSkinError) {
            m.tag("error", e.code);
        } else {
            m.tag("error", e.name);
        }
        m.inc();
        if (account) {
            try {
                account.successCounter = 0;
                account.errorCounter++;
                account.totalErrorCounter++;
                account.lastErrorCode = e.code;
                if (e instanceof AuthenticationError) {
                    account.forcedTimeoutAt = Math.floor(Date.now() / 1000);
                    console.warn(warn(options.breadcrumb + " [Generator] Account #" + account.id + " forced timeout"));
                    account.updateRequestServer(null);
                }

                if (account.errorCounter > 0 && account.errorCounter % 10 === 0) {
                    Notifications.notifyHighErrorCount(account, type, e);
                }

                await account.save();
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

    protected static async validateTempFile(tempFile: TempFile, options: GenerateOptions, client: ClientInfo, type: GenerateType): Promise<TempFileValidationResult> {
        // Validate downloaded image file
        const imageBuffer = await fs.readFile(tempFile.path);
        const size = imageBuffer.byteLength;
        Sentry.setExtra("generate_filesize", size);
        if (!size || size < 100 || size > MAX_IMAGE_SIZE) {
            throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid file size", 400);
        }

        let fType;
        try {
            fType = await fileType.fromBuffer(imageBuffer);
        } catch (e) {
            throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to determine file type", 400, undefined, e);
        }
        Sentry.setExtra("generate_mime", fType?.mime)
        if (!fType || !fType.mime.startsWith("image") || !ALLOWED_IMAGE_TYPES.includes(fType.mime)) {
            throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid file type: " + fType, 400);
        }

        let dimensions;
        try {
            dimensions = imageSize(imageBuffer);
        } catch (e) {
            throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to determine image dimensions", 400, undefined, e);
        }
        Sentry.setExtra("generate_dimensions", `${ dimensions.width }x${ dimensions.height }`);
        if ((dimensions.width !== 64) || (dimensions.height !== 64 && dimensions.height !== 32)) {
            throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image dimensions. Must be 64x32 or 64x64 (Were " + dimensions.width + "x" + dimensions.height + ")", 400);
        }

        // Get the imageHash
        let imageHash;
        try {
            imageHash = await imgHash(imageBuffer);
        } catch (e) {
            throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to get image hash", 400, undefined, e);
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
            throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to validate image data", 400, undefined, e);
        }

        return {
            buffer: imageBuffer,
            size: size,
            dimensions: dimensions,
            fileType: fType,
            hash: imageHash
        };
    }

    protected static decodeValue(data: SkinData): SkinValue {
        const decoded = JSON.parse(base64decode(data.value)) as SkinValue;
        data.decodedValue = decoded;
        return decoded;
    }

    public static async getMojangHash(url: string): Promise<MojangHashInfo> {
        const tempFile = await Temp.file({
            dir: MOJ_DIR
        });
        try {
            await Temp.downloadImage(url, tempFile);
            const imageBuffer = await fs.readFile(tempFile.path);
            let fType: Maybe<FileTypeResult> = { mime: "image/png", ext: "png" };
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
        } finally {
            if (tempFile) {
                tempFile.remove();
            }
        }
    }

    protected static async compareImageAndMojangHash(imageHash: string, mojangHash: string, type: GenerateType, options: GenerateOptions, account: IAccountDocument): Promise<boolean> {
        if (imageHash === mojangHash) {
            return true;
        }
        const metrics = await MineSkinMetrics.get();
        console.warn(warn(options.breadcrumb + " image hash does not match mojang hash (" + imageHash + " != " + mojangHash + ")"));
        metrics.hashMismatch
            .tag('server', metrics.config.server)
            .tag('type', type)
            .tag('account', account.id)
            .inc();
        return false;
    }

    protected static async validateImageData(buffer: Buffer): Promise<ImageDataValidationResult> {
        const image = await Jimp.read(buffer);
        const width = image.getWidth();
        const height = image.getHeight();
        if ((width !== 64) || (height !== 64 && height !== 32)) {
            throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image dimensions. Must be 64x32 or 64x64 (Were " + width + "x" + height + ")", 400);
        }
        if (height < 64) {
            return {
                model: SkinModel.CLASSIC,
                variant: SkinVariant.CLASSIC
            };
        }
        // https://github.com/InventivetalentDev/MineRender/blob/master/src/skin/index.js#L146
        let allTransparent = true;
        image.scan(54, 20, 2, 12, function (x, y, idx) {
            let a = this.bitmap.data[idx + 3];
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

    async toResponseJson(delay?: number): Promise<SkinInfo> {
        const info = await this.skin.toResponseJson();
        info.duplicate = this.duplicate;
        if (delay) {
            info.nextRequest = delay;
        }
        return info;
    }
}

interface GenerateResult {
    duplicate?: ISkinDocument;
    data?: SkinData;
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

export enum GenError {
    FAILED_TO_CREATE_ID = "failed_to_create_id",
    NO_ACCOUNT_AVAILABLE = "no_account_available",
    SKIN_CHANGE_FAILED = "skin_change_failed",
    INVALID_IMAGE = "invalid_image",
    INVALID_IMAGE_URL = "invalid_image_url",
    INVALID_IMAGE_UPLOAD = "invalid_image_upload",
    INVALID_SKIN_DATA = "invalid_skin_data",
    NO_DUPLICATE = "no_duplicate"
}

export class GeneratorError extends MineSkinError {
    constructor(code: GenError, msg: string, httpCode: number = 500, public account?: IAccountDocument, public details?: any) {
        super(code, msg, httpCode);
        Object.setPrototypeOf(this, GeneratorError.prototype);
    }

    get name(): string {
        return 'GeneratorError';
    }
}

export enum DuplicateSource {
    MINESKIN_URL = "mineskin_url",
    TEXTURE_URL = "texture_url",
    IMAGE_HASH = "image_hash",
    USER_UUID = "user_uuid"
}

