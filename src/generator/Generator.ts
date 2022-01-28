import { Account, Skin } from "../database/schemas";
import { MemoizeExpiring } from "@inventivetalent/typescript-memoize";
import { base64decode, getHashFromMojangTextureUrl, hasOwnProperty, imgHash, longAndShortUuid, Maybe, random32BitNumber, sleep, stripUuid } from "../util";
import { Caching } from "./Caching";
import { Authentication, AuthenticationError } from "./Authentication";
import * as Sentry from "@sentry/node";
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
import { IAccountDocument, ISkinDocument, MineSkinError } from "../typings";
import { SkinData, SkinMeta, SkinValue } from "../typings/SkinData";
import { GenerateOptions } from "../typings/GenerateOptions";
import { GenerateType, SkinModel, SkinVariant, SkinVisibility } from "../typings/db/ISkinDocument";
import { AllStats } from "../typings/AllStats";
import { ClientInfo } from "../typings/ClientInfo";
import { debug, error, info, warn } from "../util/colors";
import { SkinInfo } from "../typings/SkinInfo";
import { Bread } from "../typings/Bread";
import { Notifications } from "../util/Notifications";
import { IApiKeyDocument } from "../typings/db/IApiKeyDocument";
import stripUserAgent from "user-agent-stripper";
import { MineSkinMetrics } from "../util/metrics";
import { MineSkinOptimus } from "../util/optimus";
import { Discord } from "../util/Discord";
import { Stats } from "./Stats";
import { IPoint } from "influx";
import { DelayInfo } from "../typings/DelayInfo";
import { FilterQuery } from "mongoose";


// minimum delay for accounts to be used - don't set lower than 60
export const MIN_ACCOUNT_DELAY = 70;

const MAX_ID_TRIES = 10;

const MINESKIN_URL_REGEX = /https?:\/\/minesk(\.in|in\.org)\/([0-9a-zA-Z]+)/i;
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

    protected static serverAccounts: number;
    protected static usableAccounts: number;

    private static accountStatsTimer = setInterval(() => Generator.queryAccountStats(), 1000 * 30);

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
        const d = Math.max(Math.min(config.delays.default, await apiKey.getMinDelay()), minDelay);
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
        return delay;
    }

    @MemoizeExpiring(30000)
    static async getPreferredAccountServer(accountType?: string): Promise<string> {
        const config = await getConfig();
        return await Account.getPreferredAccountServer(accountType) || config.server;
    }

    // Stats

    @MemoizeExpiring(60000)
    static async getStats(): Promise<AllStats> {
        const config = await getConfig();
        const delay = await this.getMinDelay();

        const stats = <AllStats>{
            server: config.server,
            delay: Math.round(delay), //TODO: maybe add a ms version
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

    public static async usableAccountsQuery(): Promise<FilterQuery<IAccountDocument>> {
        const time = Math.floor(Date.now() / 1000);
        const config = await getConfig();
        return {
            enabled: true,
            id: { $nin: Caching.getLockedAccounts() },
            $and: [
                {
                    $or: [
                        { requestServer: { $exists: false } },
                        { requestServer: { $in: ["default", config.server] } },
                        { requestServer: null }
                    ]
                },
                {
                    $or: [
                        { lastSelected: { $exists: false } },
                        { lastSelected: { $lt: (time - MIN_ACCOUNT_DELAY) } }
                    ]
                },
                {
                    $or: [
                        { lastUsed: { $exists: false } },
                        { lastUsed: { $lt: (time - MIN_ACCOUNT_DELAY) } }
                    ]
                },
                {
                    $or: [
                        { forcedTimeoutAt: { $exists: false } },
                        { forcedTimeoutAt: { $lt: (time - 500) } }
                    ]
                },
                {
                    $or: [
                        { hiatus: { $exists: false } },
                        { 'hiatus.enabled': false },
                        { 'hiatus.lastPing': { $lt: (time - 900) } }
                    ]
                }
            ],
            errorCounter: { $lt: (config.errorThreshold || 10) },
            timeAdded: { $lt: (time - 60) }
        }
    }


    protected static async queryAccountStats(): Promise<void> {
        const start = Date.now();
        const config = await getConfig();

        // const enabledAccounts = await Account.countDocuments({
        //     enabled: true
        // }).exec();
        const serverAccounts = await Account.countDocuments({
            enabled: true,
            requestServer: config.server
        }).exec();
        this.serverAccounts = serverAccounts;

        const usableAccounts = await Account.countDocuments(await this.usableAccountsQuery()).exec();
        this.usableAccounts = usableAccounts;

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

        try {
            const metrics = await MineSkinMetrics.get();
            await metrics.metrics!.influx.writePoints([
                {
                    measurement: 'accounts',
                    tags: {
                        server: metrics.config.server
                    },
                    fields: {
                        totalServer: serverAccounts,
                        useable: usableAccounts
                    }
                }
            ], {
                database: 'mineskin'
            })

            let accountsPerTypePoints: IPoint[] = [];
            for (let accountType in accountTypes) {
                accountsPerTypePoints.push({
                    measurement: 'account_types',
                    tags: {
                        server: metrics.config.server,
                        type: accountType
                    },
                    fields: {
                        count: accountTypes[accountType]
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
        const existing = await Skin.findOne({ id: newId }, "id").lean().exec();
        if (existing && existing.hasOwnProperty("id")) {
            return this.makeRandomSkinId(tryN + 1);
        }
        return newId;
    }


    static async getSkinData(accountOrUuid: IAccountDocument | { uuid: string }): Promise<SkinData> {
        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
        const span = transaction?.startChild({
            op: "generate_getSkinData"
        })

        const uuid = stripUuid(accountOrUuid.uuid);
        const data = await Caching.getSkinData(uuid);
        if (!data || !data.value) {
            span?.setStatus("internal_error").finish();
            throw new GeneratorError(GenError.INVALID_SKIN_DATA, "Skin data was invalid", 500, hasOwnProperty(accountOrUuid, "id") ? accountOrUuid as IAccountDocument : undefined, data);
        }
        const decodedValue = this.decodeValue(data);
        if (!decodedValue || !decodedValue.textures || !decodedValue.textures.SKIN) {
            span?.setStatus("internal_error").finish();
            throw new GeneratorError(GenError.INVALID_SKIN_DATA, "Skin data has no skin info", 500, hasOwnProperty(accountOrUuid, "id") ? accountOrUuid as IAccountDocument : undefined, data);
        }
        span?.finish();
        return data;
    }


    protected static async saveSkin(result: GenerateResult, options: GenerateOptions, client: ClientInfo, type: GenerateType, start: number): Promise<ISkinDocument> {
        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
        const span = transaction?.startChild({
            op: "generate_saveSkin"
        })

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
            capeUrl: result.data?.decodedValue?.textures?.CAPE?.url,
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
            span?.finish();
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

        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
        const span = transaction?.startChild({
            op: "generate_findDuplicateFromUrl"
        })

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
                    metrics.newDuplicate
                        .tag("newOrDuplicate", "duplicate")
                        .tag("server", metrics.config.server)
                        .tag("source", DuplicateSource.MINESKIN_URL)
                        .tag("type", type)
                        .inc();
                } catch (e) {
                    Sentry.captureException(e);
                }
                span?.setData("duplicate", true).finish();
                return await existingSkin.save();
            } else {
                span?.setData("duplicate", false).finish();
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
                span?.setData("duplicate", true).finish();
                return await existingSkin.save();
            } else {
                span?.setData("duplicate", false).finish();
                return undefined;
            }
        }

        span?.setData("duplicate", false).finish();
        return undefined;
    }

    protected static async findDuplicateFromImageHash(hash: string, options: GenerateOptions, client: ClientInfo, type: GenerateType): Promise<Maybe<ISkinDocument>> {
        const metrics = await MineSkinMetrics.get();
        if (!hash || hash.length < 30) {
            return undefined;
        }

        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
        const span = transaction?.startChild({
            op: "generate_findDuplicateFromImageHash"
        })

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
            span?.setData("duplicate", true).finish();
            return await existingSkin.save();
        } else {
            span?.setData("duplicate", false).finish();
            return undefined;
        }
    }

    protected static async findDuplicateFromUuid(uuid: string, options: GenerateOptions, type: GenerateType): Promise<Maybe<ISkinDocument>> {
        const metrics = await MineSkinMetrics.get();
        if (!uuid || uuid.length < 34) {
            return undefined;
        }

        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
        const span = transaction?.startChild({
            op: "generate_findDuplicateFromUuid"
        })

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
            span?.setData("duplicate", true).finish();
            return await existingSkin.save();
        } else {
            span?.setData("duplicate", false).finish();
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

        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
        const span = transaction?.startChild({
            op: "generate_generateFromUrl"
        })

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
                span?.finish();
                return {
                    duplicate: originalUrlDuplicate
                };
            }
            // Fix user errors
            originalUrl = this.rewriteUrl(originalUrl, options);
            // Try to find the source image
            const followResponse = await this.followUrl(originalUrl, options.breadcrumb);
            if (!followResponse) {
                span?.setStatus("invalid_argument").finish()
                throw new GeneratorError(GenError.INVALID_IMAGE_URL, "Failed to find image from url", 400, undefined, originalUrl);
            }
            // Validate response headers
            const url = this.getUrlFromResponse(followResponse, originalUrl);
            if (!url) {
                span?.setStatus("invalid_argument").finish()
                throw new GeneratorError(GenError.INVALID_IMAGE_URL, "Failed to follow url", 400, undefined, originalUrl);
            }
            Sentry.setExtra("generate_url_followed", url);
            // Check for duplicate from url again, if the followed url is different
            if (url !== originalUrl) {
                const followedUrlDuplicate = await this.findDuplicateFromUrl(url, options, GenerateType.URL);
                if (followedUrlDuplicate) {
                    span?.finish()
                    return {
                        duplicate: followedUrlDuplicate
                    };
                }
            }
            const contentType = this.getContentTypeFromResponse(followResponse);
            Sentry.setExtra("generate_contentType", contentType);
            if (!contentType || !contentType.startsWith("image") || !ALLOWED_IMAGE_TYPES.includes(contentType)) {
                span?.setStatus("invalid_argument").finish()
                throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image content type: " + contentType, 400, undefined, originalUrl);
            }
            const size = this.getSizeFromResponse(followResponse);
            Sentry.setExtra("generate_contentLength", size);
            if (!size || size < 100 || size > MAX_IMAGE_SIZE) {
                span?.setStatus("invalid_argument").finish();
                throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image file size", 400, undefined, originalUrl);
            }

            // Download the image temporarily
            tempFile = await Temp.file({
                dir: URL_DIR
            });
            try {
                await Temp.downloadImage(url, tempFile)
            } catch (e) {
                span?.setStatus("internal_error").finish();
                throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to download image", 500, undefined, e);
            }

            // Validate downloaded image file
            const tempFileValidation = await this.validateTempFile(tempFile, options, client, GenerateType.URL);
            if (tempFileValidation.duplicate) {
                // found a duplicate
                span?.finish();
                return tempFileValidation;
            }

            if (options.checkOnly) {
                span?.setStatus("not_found").finish();
                throw new GeneratorError(GenError.NO_DUPLICATE, "No duplicate found", 404, undefined)
            }

            /// Run generation for new skin

            account = await this.getAndAuthenticateAccount(options);
            await this.clearCapeIfRequired(account);

            const skinResponse = await this.changeSkinUrl(account, url, options.variant, options.breadcrumb);
            span?.finish();
            return this.handleSkinChangeResponse(skinResponse, GenerateType.URL, options, client, account, tempFileValidation);
        } catch (e) {
            span?.setStatus("internal_error").finish();
            await this.handleGenerateError(e, GenerateType.URL, options, client, account);
            throw e;
        } finally {
            if (tempFile) {
                tempFile.remove();
            }
        }

    }

    protected static async changeSkinUrl(account: IAccountDocument, url: string, variant: string, breadcrumb?: string): Promise<AxiosResponse> {
        const body = {
            variant: variant,
            url: url
        };
        return await Requests.minecraftServicesProfileRequest({
            method: "POST",
            url: "/minecraft/profile/skins",
            headers: {
                "Content-Type": "application/json",
                "Authorization": account.authenticationHeader()
            },
            data: body
        }, breadcrumb).catch(err => {
            if (err.response) {
                let msg = (err.response as AxiosResponse).data?.errorMessage ?? "Failed to change skin";
                throw new GeneratorError(GenError.SKIN_CHANGE_FAILED, msg, (err.response as AxiosResponse).status, account, err);
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

    protected static async followUrl(urlStr: string, breadcrumb?: string): Promise<Maybe<AxiosResponse>> {
        if (!urlStr) return undefined;

        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
        const span = transaction?.startChild({
            op: "generate_followUrl"
        })

        try {
            const url = new URL(urlStr);
            if (!url.host || !url.pathname) {
                span?.finish();
                return undefined;
            }
            if (!url.protocol || (url.protocol !== "http:" && url.protocol !== "https:")) {
                span?.finish();
                return undefined;
            }
            const follow = URL_FOLLOW_WHITELIST.includes(url.host!);
            return await Requests.genericRequest({
                method: "GET",
                url: url.href,
                maxRedirects: follow ? MAX_FOLLOW_REDIRECTS : 0,
                headers: {
                    "User-Agent": "MineSkin"
                }
            }, breadcrumb).then(res => {
                span?.finish();
                return res;
            });
        } catch (e) {
            Sentry.captureException(e);
        }
        span?.finish();
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

        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
        const span = transaction?.startChild({
            op: "generate_generateFromUpload"
        })

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
                span?.setStatus("internal_error").finish();
                throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to upload image", 500, undefined, e);
            }

            // Validate uploaded image file
            const tempFileValidation = await this.validateTempFile(tempFile, options, client, GenerateType.UPLOAD);
            if (tempFileValidation.duplicate) {
                // found a duplicate
                span?.finish();
                return tempFileValidation;
            }

            if (options.checkOnly) {
                span?.setStatus("not_found").finish();
                throw new GeneratorError(GenError.NO_DUPLICATE, "No duplicate found", 404, undefined)
            }

            /// Run generation for new skin

            account = await this.getAndAuthenticateAccount(options);
            await this.clearCapeIfRequired(account);

            const skinResponse = await this.changeSkinUpload(account, tempFileValidation.buffer!, options.variant, options.breadcrumb);
            span?.finish();
            return this.handleSkinChangeResponse(skinResponse, GenerateType.UPLOAD, options, client, account, tempFileValidation);
        } catch (e) {
            span?.setStatus("internal_error").finish();
            await this.handleGenerateError(e, GenerateType.UPLOAD, options, client, account);
            throw e;
        } finally {
            if (tempFile) {
                tempFile.remove();
            }
        }
    }

    protected static async changeSkinUpload(account: IAccountDocument, file: ArrayBufferLike, variant: string, breadcrumb?: string): Promise<AxiosResponse> {
        const body = new FormData();
        body.append("variant", variant);
        body.append("file", file, {
            filename: "skin.png",
            contentType: "image/png"
        });
        return await Requests.minecraftServicesProfileRequest({
            method: "POST",
            url: "/minecraft/profile/skins",
            headers: body.getHeaders({
                "Authorization": account.authenticationHeader()
            }),
            data: body
        }, breadcrumb).catch(err => {
            if (err.response) {
                let msg = (err.response as AxiosResponse).data?.errorMessage ?? "Failed to change skin";
                throw new GeneratorError(GenError.SKIN_CHANGE_FAILED, msg, (err.response as AxiosResponse).status, account, err);
            }
            throw err;
        });
    }

    static async handleSkinChangeResponse(skinResponse: AxiosResponse, type: GenerateType, options: GenerateOptions, client: ClientInfo, account: IAccountDocument, tempFileValidation: TempFileValidationResult): Promise<GenerateResult> {
        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
        const span = transaction?.startChild({
            op: "generate_handleSkinChangeResponse"
        })

        const skinChangeResponse = skinResponse.data as SkinChangeResponse;
        const minecraftSkinId = skinChangeResponse?.skins[0]?.id;

        const config = await getConfig();

        await sleep(200);

        const data = await this.getSkinData(account);
        if (skinChangeResponse && skinChangeResponse.skins && skinChangeResponse.skins.length > 0) {
            if (skinChangeResponse.skins[0].url !== data.decodedValue!.textures!.SKIN!.url) {
                console.warn(warn(options.breadcrumb + " Skin url returned by skin change does not match url returned by data query (" + skinChangeResponse.skins[0].url + " != " + data.decodedValue!.textures!.SKIN!.url + ")"));
                //TODO: figure out why this happens
                // TODO: maybe retry a few seconds later

                const metrics = await MineSkinMetrics.get();
                metrics.urlMismatch
                    .tag('server', metrics.config.server)
                    .tag('type', type)
                    .tag('account', account.id)
                    .inc();

                Discord.postDiscordMessage("⚠ URL mismatch\n" +
                    "  Server:       " + config.server + "\n" +
                    "  Account:      " + account.id + "/" + account.uuid + "\n" +
                    "  Changed to:   " + skinChangeResponse.skins[0].url + "\n" +
                    "  Texture Data: " + data.decodedValue!.textures!.SKIN!.url);
            }
        }
        const mojangHash = await this.getMojangHash(data.decodedValue!.textures!.SKIN!.url, options);

        const hashesMatch = await this.compareImageAndMojangHash(tempFileValidation.hash!, mojangHash!.hash!, type, options, account);
        if (!hashesMatch) {
            Discord.postDiscordMessageWithAttachment("⚠ Hash mismatch\n" +
                "  Server: " + config.server + "\n" +
                "  Image:  " + tempFileValidation.hash + "\n" +
                "  Mojang: " + mojangHash.hash + "\n" +
                data.decodedValue!.textures!.SKIN!.url,
                tempFileValidation!.buffer!, "image.png");
        }

        await this.handleGenerateSuccess(type, options, client, account);

        account.lastTextureUrl = data.decodedValue!.textures!.SKIN!.url;

        span?.finish()
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
        const data = await this.generateFromUser(user, options, client);
        const skin = await this.getDuplicateOrSaved(data, options, client, GenerateType.USER, start);
        const end = Date.now();
        (await MineSkinMetrics.get()).durationMetric(end - start, GenerateType.USER, options, data.account);
        return skin;
    }

    protected static async generateFromUser(uuid: string, options: GenerateOptions, client: ClientInfo): Promise<GenerateResult> {
        console.log(info(options.breadcrumb + " [Generator] Generating from user"));
        Sentry.setExtra("generate_user", uuid);

        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
        const span = transaction?.startChild({
            op: "generate_generateFromUser"
        })

        const uuids = longAndShortUuid(uuid)!;
        const uuidDuplicate = await this.findDuplicateFromUuid(uuids.long, options, GenerateType.USER);
        if (uuidDuplicate) {
            span?.finish();
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
            span?.finish()
            return {
                duplicate: hashDuplicate
            };
        }

        span?.finish()
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
        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
        const span = transaction?.startChild({
            op: "generate_getAndAuthenticateAccount"
        })

        const metrics = await MineSkinMetrics.get();
        let account = await Account.findUsable(bread);
        if (!account) {
            console.warn(error(bread?.breadcrumb + " [Generator] No account available!"));
            metrics.noAccounts
                .tag('server', metrics.config.server)
                .inc();
            span?.setStatus("internal_error").finish();
            throw new GeneratorError(GenError.NO_ACCOUNT_AVAILABLE, "No account available");
        }
        Sentry.setTag("account", account.id);
        Sentry.setTag("account_type", account.getAccountType());
        account = await Authentication.authenticate(account, bread);

        account.lastUsed = Math.floor(Date.now() / 1000);
        account.updateRequestServer(metrics.config.server);

        span?.finish();
        return account;
    }

    protected static async clearCape(account: IAccountDocument): Promise<boolean> {
        console.log(info(`Clearing cape of ${ account.id }/${ account.uuid }`));
        return Requests.minecraftServicesProfileRequest({
            method: "DELETE",
            url: "/minecraft/profile/capes/active",
            headers: {
                Authorization: `Bearer ${ account.accessToken }`
            }
        }).then(res => res.status === 200);
    }

    protected static async clearCapeIfRequired(account: IAccountDocument): Promise<boolean> {
        if (!account.accessToken) return true;
        const profile = await Caching.getProfileByAccessToken(account.accessToken);
        if (profile && profile.capes && profile.capes.length > 0) {
            for (let cape of profile.capes) {
                if (cape.state === "ACTIVE") {
                    return await this.clearCape(account);
                }
            }
        }
        return true;
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
        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
        const span = transaction?.startChild({
            op: "generate_validateTempFile"
        })

        // Validate downloaded image file
        const imageBuffer = await fs.readFile(tempFile.path);
        const size = imageBuffer.byteLength;
        Sentry.setExtra("generate_filesize", size);
        if (!size || size < 100 || size > MAX_IMAGE_SIZE) {
            span?.setStatus("invalid_argument").finish()
            throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid file size", 400);
        }

        let fType;
        try {
            fType = await fileType.fromBuffer(imageBuffer);
        } catch (e) {
            span?.setStatus("invalid_argument").finish()
            throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to determine file type", 400, undefined, e);
        }
        Sentry.setExtra("generate_mime", fType?.mime)
        if (!fType || !fType.mime.startsWith("image") || !ALLOWED_IMAGE_TYPES.includes(fType.mime)) {
            span?.setStatus("invalid_argument").finish()
            throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid file type: " + fType, 400);
        }

        let dimensions;
        try {
            dimensions = imageSize(imageBuffer);
        } catch (e) {
            span?.setStatus("invalid_argument").finish();
            throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to determine image dimensions", 400, undefined, e);
        }
        Sentry.setExtra("generate_dimensions", `${ dimensions.width }x${ dimensions.height }`);
        if ((dimensions.width !== 64) || (dimensions.height !== 64 && dimensions.height !== 32)) {
            span?.setStatus("invalid_argument").finish();
            throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image dimensions. Must be 64x32 or 64x64 (Were " + dimensions.width + "x" + dimensions.height + ")", 400);
        }

        // Get the imageHash
        let imageHash;
        try {
            imageHash = await imgHash(imageBuffer);
        } catch (e) {
            span?.setStatus("invalid_argument").finish();
            throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to get image hash", 400, undefined, e);
        }
        console.log(debug(options.breadcrumb + " Image hash: " + imageHash));
        // Check duplicate from imageHash
        const hashDuplicate = await this.findDuplicateFromImageHash(imageHash, options, client, type);
        if (hashDuplicate) {
            span?.finish();
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
            span?.setStatus("invalid_argument").finish();
            throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to validate image data", 400, undefined, e);
        }

        span?.finish();
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

    public static async getMojangHash(url: string, options?: GenerateOptions, t = 1): Promise<MojangHashInfo> {
        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
        const span = transaction?.startChild({
            op: "generate_getMojangHash"
        })

        const tempFile = await Temp.file({
            dir: MOJ_DIR
        });
        try {
            await Temp.downloadImage(url, tempFile, options?.breadcrumb);
            const imageBuffer = await fs.readFile(tempFile.path);
            let fType: Maybe<FileTypeResult> = { mime: "image/png", ext: "png" };
            try {
                fType = await fileType.fromBuffer(imageBuffer);
            } catch (e) {
                Sentry.captureException(e);
            }
            const hash = await imgHash(imageBuffer);
            span?.finish();
            return {
                buffer: imageBuffer,
                hash: hash
            };
        } catch (e) {
            console.warn(warn("Failed to get hash from mojang skin " + url + " (" + t + ")"));
            if (t > 0) {
                return this.getMojangHash(url, options, t - 1);
            }
            throw e;
        } finally {
            span?.finish()
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
        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
        const span = transaction?.startChild({
            op: "generate_validateImageData"
        })

        const image = await Jimp.read(buffer);
        const width = image.getWidth();
        const height = image.getHeight();
        if ((width !== 64) || (height !== 64 && height !== 32)) {
            span?.setStatus("invalid_argument").finish()
            throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image dimensions. Must be 64x32 or 64x64 (Were " + width + "x" + height + ")", 400);
        }
        if (height < 64) {
            span?.finish();
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

        span?.finish()
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

    async toResponseJson(delayInfo?: DelayInfo): Promise<SkinInfo> {
        const info = await this.skin.toResponseJson();
        info.duplicate = this.duplicate;
        if (delayInfo) {
            info.nextRequest = delayInfo.seconds; // deprecated

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

