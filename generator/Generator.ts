import { Account, Skin, Stat } from "../database/schemas";
import { MemoizeExpiring } from "typescript-memoize";
import { base64decode, debug, DUPLICATES_METRIC, durationMetric, error, getHashFromMojangTextureUrl, hasOwnProperty, imageHash, info, longAndShortUuid, Maybe, metrics, NEW_METRIC, random32BitNumber, stripUuid, warn } from "../util";
import { IAccountDocument, ISkinDocument, IStatDocument, MineSkinError } from "../types";
import { Caching } from "./Caching";
import { SkinData, SkinMeta, SkinValue } from "../types/SkinData";
import { Config } from "../types/Config";
import { GenerateType, SkinModel } from "../types/ISkinDocument";
import Optimus from "optimus-js";
import { Authentication, AuthenticationError } from "./Authentication";
import * as Sentry from "@sentry/node";
import { Requests } from "./Requests";
import * as FormData from "form-data";
import { GenerateOptions } from "../types/GenerateOptions";
import { ClientInfo } from "../types/ClientInfo";
import * as URL from "url";
import { MOJ_DIR, Temp, TempFile, UPL_DIR, URL_DIR } from "./Temp";
import { AxiosResponse } from "axios";
import imageSize from "image-size";
import { promises as fs } from "fs";
import * as fileType from "file-type";
import { FileTypeResult } from "file-type";
import { UploadedFile } from "express-fileupload";
import { ISizeCalculationResult } from "image-size/dist/types/interface";
import { v4 as uuid } from "uuid";
import { AccountStats, CountDuplicateViewStats, DurationStats, Stats, SuccessRateStats, TimeFrameStats } from "../types/Stats";
import * as Jimp from "jimp";
import { Schema } from "mongoose";

const config: Config = require("../config");

const MAX_ID_TRIES = 10;

const MINESKIN_URL_REGEX = /https?:\/\/minesk(\.in|in\.org)\/([0-9]+)/i;
const MINECRAFT_TEXTURE_REGEX = /https?:\/\/textures\.minecraft\.net\/texture\/([0-9a-z]+)/i;

const URL_FOLLOW_WHITELIST = [
    "novask.in",
    "imgur.com"
];
const MAX_FOLLOW_REDIRECTS = 5;

const MAX_IMAGE_SIZE = 20000; // 20KB - about 70x70px at 32bit
const ALLOWED_IMAGE_TYPES = ["image/png"];

export class Generator {

    protected static readonly optimus = new Optimus(config.optimus.prime, config.optimus.inverse, config.optimus.random);

    protected static accountStats: AccountStats;
    protected static durationStats: DurationStats;
    protected static successRateStats: SuccessRateStats;
    protected static countDuplicateViewStats: CountDuplicateViewStats;
    protected static timeFrameStats: TimeFrameStats;

    protected static detailedStatsQueryTimer = setInterval(() => Generator.queryDetailedStats(), 240000);

    @MemoizeExpiring(30000)
    static async getDelay(): Promise<number> {
        return Account.calculateDelay();
    }

    @MemoizeExpiring(30000)
    static async getPreferredAccountServer(): Promise<string> {
        return await Account.getPreferredAccountServer() || config.server;
    }

    // Stats

    @MemoizeExpiring(60000)
    static async getStats(): Promise<Stats> {
        const delay = await this.getDelay();

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
        this.accountStats = await this.queryAccountStats();
        this.durationStats = await this.queryDurationStats();
        this.successRateStats = await this.querySuccessRateStats();
        this.countDuplicateViewStats = await this.queryCountDuplicateViewStats();
        this.timeFrameStats = await this.queryTimeFrameStats();

        try {
            await metrics.influx.writePoints([
                {
                    measurement: 'accounts',
                    tags: {
                        server: config.server
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
        } catch (e) {
            console.warn(e);
            Sentry.captureException(e);
        }
    }

    protected static async queryAccountStats(): Promise<AccountStats> {
        const time = Date.now() / 1000;

        const enabledAccounts = await Account.count({
            enabled: true
        }).exec();
        const serverAccounts = await Account.count({
            enabled: true,
            requestServer: config.server
        }).exec();
        const healthyAccounts = await Account.countGlobalUsable();
        const useableAccounts = await Account.count({
            enabled: true,
            requestServer: { $in: [undefined, "default", config.server] },
            lastUsed: { '$lt': (time - 100) },
            forcedTimeoutAt: { '$lt': (time - 500) },
            errorCounter: { '$lt': (config.errorThreshold || 10) },
            timeAdded: { $lt: (time - 60) }
        }).exec();

        return {
            accounts: enabledAccounts,
            serverAccounts,
            healthyAccounts,
            useableAccounts
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
        const newId = this.optimus.encode(rand);
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
        const id = await this.makeNewSkinId();
        const skin: ISkinDocument = new Skin(<ISkinDocument>{
            id: id,

            hash: result.meta?.imageHash,
            uuid: result.meta?.uuid,

            name: options.name,
            model: options.model,
            visibility: options.visibility,

            value: result.data!.value,
            signature: result.data!.signature,
            url: result.data!.decodedValue!.textures!.SKIN!.url!,
            minecraftTextureHash: getHashFromMojangTextureUrl(result.data!.decodedValue!.textures.SKIN!.url!),
            textureHash: result.meta?.mojangHash,

            time: (Date.now() / 1000),
            generateDuration: (Date.now() - start),

            account: result.account?.id,
            type: type,

            via: client.via,
            ua: client.userAgent,

            duplicate: 0,
            views: 0
        })
        return skin.save();
    }

    protected static async getDuplicateOrSaved(result: GenerateResult, options: GenerateOptions, client: ClientInfo, type: GenerateType, start: number): Promise<ISkinDocument> {
        if (result.duplicate) {
            return result.duplicate;
        }
        if (result.data) {
            try {
                NEW_METRIC
                    .tag("server", config.server)
                    .tag("type", type)
                    .inc();
            } catch (e) {
                Sentry.captureException(e);
            }
            return await this.saveSkin(result, options, client, type, start);
        }
        // shouldn't ever get here
        throw new MineSkinError('unknown', "Something went wrong while generating");
    }

    /// DUPLICATE CHECKS

    protected static async findDuplicateFromUrl(url: string, options: GenerateOptions, type: GenerateType): Promise<Maybe<ISkinDocument>> {
        if (!url || url.length < 8 || !url.startsWith("http")) {
            return undefined;
        }

        const mineskinUrlResult = MINESKIN_URL_REGEX.exec(url);
        if (!!mineskinUrlResult && mineskinUrlResult.length >= 3) {
            const mineskinId = parseInt(mineskinUrlResult[2]);
            const existingSkin = await Skin.findOne({
                id: mineskinId,
                name: options.name, model: options.model, visibility: options.visibility
            }).exec();
            if (existingSkin) {
                existingSkin.duplicate++;
                try {
                    DUPLICATES_METRIC
                        .tag("server", config.server)
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
                ],
                name: options.name, model: options.model, visibility: options.visibility
            });
            if (existingSkin) {
                existingSkin.duplicate++;
                try {
                    DUPLICATES_METRIC
                        .tag("server", config.server)
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

    protected static async findDuplicateFromImageHash(hash: string, options: GenerateOptions, type: GenerateType): Promise<Maybe<ISkinDocument>> {
        if (!hash || hash.length < 30) {
            return undefined;
        }

        const existingSkin = await Skin.findOne({
            hash: hash,
            name: options.name, model: options.name, visibility: options.visibility
        }).exec();
        if (existingSkin) {
            existingSkin.duplicate++;
            try {
                DUPLICATES_METRIC
                    .tag("server", config.server)
                    .tag("source", DuplicateSource.IMAGE_HASH)
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

    protected static async findDuplicateFromUuid(uuid: string, options: GenerateOptions, type: GenerateType): Promise<Maybe<ISkinDocument>> {
        if (!uuid || uuid.length < 34) {
            return undefined;
        }

        const existingSkin = await Skin.findOne({
            uuid: uuid,
            name: options.name, model: options.name, visibility: options.visibility
        }).exec();
        if (existingSkin) {
            existingSkin.duplicate++;
            try {
                DUPLICATES_METRIC
                    .tag("server", config.server)
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

    public static async generateFromUrlAndSave(url: string, options: GenerateOptions, client: ClientInfo): Promise<ISkinDocument> {
        const start = Date.now();
        const data = await this.generateFromUrl(url, options);
        const doc = await this.getDuplicateOrSaved(data, options, client, GenerateType.URL, start);
        const end = Date.now();
        durationMetric(end - start, GenerateType.URL, options, data.account);
        return doc;
    }

    protected static async generateFromUrl(originalUrl: string, options: GenerateOptions): Promise<GenerateResult> {
        console.log(info("[Generator] Generating from url"));

        let account: Maybe<IAccountDocument> = undefined;
        let tempFile: Maybe<TempFile> = undefined;
        try {
            // Try to find the source image
            const followResponse = await this.followUrl(originalUrl);
            if (!followResponse) {
                throw new GeneratorError(GenError.INVALID_IMAGE_URL, "Failed to find image from url");
            }
            // Validate response headers
            const url = this.getUrlFromResponse(followResponse);
            if (!url) {
                throw new GeneratorError(GenError.INVALID_IMAGE_URL, "Failed to follow url");
            }
            // Check for duplicate from url
            const urlDuplicate = await this.findDuplicateFromUrl(url, options, GenerateType.URL);
            if (urlDuplicate) {
                return {
                    duplicate: urlDuplicate
                };
            }
            const contentType = this.getContentTypeFromResponse(followResponse);
            if (!contentType || !contentType.startsWith("image") || !ALLOWED_IMAGE_TYPES.includes(contentType)) {
                throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image content type: " + contentType, 400);
            }
            const size = this.getSizeFromResponse(followResponse);
            if (!size || size < 100 || size > MAX_IMAGE_SIZE) {
                throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image file size", 400);
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
            const tempFileValidation = await this.validateTempFile(tempFile, options, GenerateType.URL);
            if (tempFileValidation.duplicate) {
                // found a duplicate
                return tempFileValidation;
            }

            /// Run generation for new skin

            account = await this.getAndAuthenticateAccount();

            const body = {
                variant: options.model,
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
                    throw new GeneratorError(GenError.SKIN_CHANGE_FAILED, "Failed to change skin", 500, account, err);
                }
                throw err;
            })

            const data = await this.getSkinData(account);
            const mojangHash = await this.getMojangHash(data.decodedValue!.textures!.SKIN!.url);

            await this.handleGenerateSuccess(account);

            return {
                data: data,
                account: account,
                meta: {
                    uuid: uuid(),
                    imageHash: tempFileValidation.hash!,
                    mojangHash: mojangHash!
                }
            };
        } catch (e) {
            await this.handleGenerateError(e, account);
            throw e;
        } finally {
            if (tempFile) {
                tempFile.remove();
            }
        }

    }

    protected static async followUrl(urlStr: string): Promise<Maybe<AxiosResponse>> {
        if (!urlStr) return undefined;
        try {
            const url = URL.parse(urlStr, false);
            if (URL_FOLLOW_WHITELIST.includes(url.host!)) {
                return await Requests.axiosInstance.request({
                    method: "HEAD",
                    url: url.href,
                    maxRedirects: MAX_FOLLOW_REDIRECTS,
                    headers: {
                        "User-Agent": "MineSkin"
                    }
                });
            }
        } catch (e) {
            Sentry.captureException(e);
        }
        return undefined;
    }


    /// GENERATE UPLOAD

    public static async generateFromUploadAndSave(file: UploadedFile, options: GenerateOptions, client: ClientInfo): Promise<ISkinDocument> {
        const start = Date.now();
        const data = await this.generateFromUpload(file, options);
        const doc = await this.getDuplicateOrSaved(data, options, client, GenerateType.UPLOAD, start);
        const end = Date.now();
        durationMetric(end - start, GenerateType.UPLOAD, options, data.account);
        return doc;
    }

    protected static async generateFromUpload(file: UploadedFile, options: GenerateOptions): Promise<GenerateResult> {
        console.log(info("[Generator] Generating from upload"));

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
            const tempFileValidation = await this.validateTempFile(tempFile, options, GenerateType.UPLOAD);
            if (tempFileValidation.duplicate) {
                // found a duplicate
                return tempFileValidation;
            }

            /// Run generation for new skin

            account = await this.getAndAuthenticateAccount();

            const body = new FormData();
            body.append("variant", options.model);
            body.append("file", new Blob([tempFileValidation.buffer!], { type: "image/png" }), {
                filename: "skin.png",
                contentType: "image/png"
            });
            const skinResponse = await Requests.minecraftServicesRequest({
                method: "POST",
                url: "/minecraft/profile/skins",
                headers: body.getHeaders({
                    "Content-Type": "multipart/form-data",
                    "Authorization": account.authenticationHeader()
                }),
                data: body
            }).catch(err => {
                if (err.response) {
                    throw new GeneratorError(GenError.SKIN_CHANGE_FAILED, "Failed to change skin", 500, account, err);
                }
                throw err;
            });

            const data = await this.getSkinData(account);
            const mojangHash = await this.getMojangHash(data.decodedValue!.textures!.SKIN!.url);

            await this.handleGenerateSuccess(account);

            return {
                data: data,
                account: account,
                meta: {
                    uuid: uuid(),
                    imageHash: tempFileValidation.hash!,
                    mojangHash: mojangHash!
                }
            };
        } catch (e) {
            await this.handleGenerateError(e, account);
            throw e;
        } finally {
            if (tempFile) {
                tempFile.remove();
            }
        }
    }

    /// GENERATE USER

    public static async generateFromUserAndSave(user: string, options: GenerateOptions, client: ClientInfo): Promise<ISkinDocument> {
        const start = Date.now();
        const data = await this.generateFromUser(user, options);
        const doc = await this.getDuplicateOrSaved(data, options, client, GenerateType.USER, start);
        const end = Date.now();
        durationMetric(end - start, GenerateType.USER, options, data.account);
        return doc;
    }

    protected static async generateFromUser(uuid: string, options: GenerateOptions): Promise<GenerateResult> {
        console.log(info("[Generator] Generating from user"));

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
                imageHash: mojangHash,
                mojangHash: mojangHash
            }
        };
    }

    /// AUTH

    protected static async getAndAuthenticateAccount(): Promise<IAccountDocument> {
        let account = await Account.findUsable();
        if (!account) {
            console.warn(error("[Generator] No account available!"));
            throw new GeneratorError(GenError.NO_ACCOUNT_AVAILABLE, "No account available");
        }
        account = await Authentication.authenticate(account);

        account.lastUsed = Math.floor(Date.now() / 1000);
        account.updateRequestServer(config.server);

        return account;
    }

    /// SUCCESS / ERROR HANDLERS

    protected static async handleGenerateSuccess(account: IAccountDocument): Promise<void> {
        if (!account) return;
        try {
            account.errorCounter = 0;
            account.successCounter++;
            account.totalSuccessCounter++;
            await account.save();
        } catch (e1) {
            Sentry.captureException(e1);
        }
    }

    protected static async handleGenerateError(e: any, account?: IAccountDocument): Promise<void> {
        if (!account) return;
        try {
            account.successCounter = 0;
            account.errorCounter++;
            account.totalErrorCounter++;
            if (e instanceof AuthenticationError) {
                account.forcedTimeoutAt = Math.floor(Date.now() / 1000);
                console.warn(warn("[Generator] Account #" + account.id + " forced timeout"));
                account.updateRequestServer(undefined);
            }
            await account.save();
        } catch (e1) {
            Sentry.captureException(e1);
        }
    }


    /// VALIDATION

    protected static getUrlFromResponse(response: AxiosResponse): string {
        return response.request.res.responseUrl;
    }

    protected static getSizeFromResponse(response: AxiosResponse): number {
        return response.headers["content-length"];
    }

    protected static getContentTypeFromResponse(response: AxiosResponse): string {
        return response.headers["content-type"];
    }

    protected static async validateTempFile(tempFile: TempFile, options: GenerateOptions, type: GenerateType): Promise<TempFileValidationResult> {
        // Validate downloaded image file
        const imageBuffer = await fs.readFile(tempFile.path);
        const size = imageBuffer.byteLength;
        if (!size || size < 100 || size > MAX_IMAGE_SIZE) {
            throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid file size", 400);
        }
        const dimensions = imageSize(imageBuffer);
        if ((dimensions.width !== 64) || (dimensions.height !== 64 && dimensions.height !== 32)) {
            throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image dimensions. Must be 64x32 or 64x64 (Were " + dimensions.width + "x" + dimensions.height + ")", 400);
        }
        const fType = await fileType.fromBuffer(imageBuffer);
        if (!fType || !fType.mime.startsWith("image") || !ALLOWED_IMAGE_TYPES.includes(fType.mime)) {
            throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid file type: " + fType, 400);
        }

        const dataValidation = await this.validateImageData(imageBuffer);
        if (options.model === SkinModel.UNKNOWN && dataValidation.model !== SkinModel.UNKNOWN) {
            console.log(debug("Switching unknown skin model to " + dataValidation.model + " from detection"));
            options.model = dataValidation.model;
        }

        // Get the imageHash
        const imgHash = await imageHash(imageBuffer);
        // Check duplicate from imageHash
        const hashDuplicate = await this.findDuplicateFromImageHash(imgHash, options, type);
        if (hashDuplicate) {
            return {
                duplicate: hashDuplicate
            };
        }

        return {
            buffer: imageBuffer,
            size: size,
            dimensions: dimensions,
            fileType: fType,
            hash: imgHash
        };
    }

    protected static decodeValue(data: SkinData): SkinValue {
        const decoded = JSON.parse(base64decode(data.value)) as SkinValue;
        data.decodedValue = decoded;
        return decoded;
    }

    protected static async getMojangHash(url: string): Promise<string> {
        const tempFile = await Temp.file({
            dir: MOJ_DIR
        });
        try {
            await Temp.downloadImage(url, tempFile);
            const imageBuffer = await fs.readFile(tempFile.path);
            return await imageHash(imageBuffer);
        } finally {
            if (tempFile) {
                tempFile.remove();
            }
        }
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
                model: SkinModel.CLASSIC
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
                model: SkinModel.SLIM
            };
        } else {
            return {
                model: SkinModel.CLASSIC
            }
        }
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

interface ImageDataValidationResult {
    model: SkinModel;
}

export enum GenError {
    FAILED_TO_CREATE_ID = "failed_to_create_id",
    NO_ACCOUNT_AVAILABLE = "no_account_available",
    SKIN_CHANGE_FAILED = "skin_change_failed",
    INVALID_IMAGE = "invalid_image",
    INVALID_IMAGE_URL = "invalid_image_url",
    INVALID_IMAGE_UPLOAD = "invalid_image_upload",
    INVALID_SKIN_DATA = "invalid_skin_data"
}

export class GeneratorError extends MineSkinError {
    constructor(code: GenError, msg: string, httpCode: number = 500, public account?: IAccountDocument, public details?: any) {
        super(code, msg, httpCode);
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

