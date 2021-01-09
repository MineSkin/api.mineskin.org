import { Account, Skin } from "../database/schemas";
import { MemoizeExpiring } from "typescript-memoize";
import { DUPLICATES_METRIC, error, info, random32BitNumber, stripUuid, warn } from "../util";
import { IAccountDocument, ISkinDocument, MineSkinError } from "../types";
import { Caching } from "./Caching";
import { SkinData } from "../types/SkinData";
import { Config } from "../types/Config";
import { SkinModel, ISkinModel } from "../types/ISkinDocument";
import Optimus from "optimus-js";
import { Authentication, AuthenticationError, AuthError } from "./Authentication";
import * as crypto from "crypto";
import * as Sentry from "@sentry/node";
import { Requests } from "./Requests";
import * as FormData from "form-data";
import { GenerateOptions } from "../types/GenerateOptions";
import { ClientInfo } from "../types/ClientInfo";
import * as URL from "url";
import { urls } from "./urls";


const config: Config = require("../config");

const MAX_ID_TRIES = 10;

const MINESKIN_URL_REGEX = /https?:\/\/minesk(\.in|in\.org)\/([0-9]+)/i;
const MINECRAFT_TEXTURE_REGEX = /https?:\/\/textures\.minecraft\.net\/texture\/([0-9a-z]+)/i;

const URL_FOLLOW_WHITELIST = [
    "novask.in",
    "imgur.com"
];
const MAX_FOLLOW_REDIRECTS = 5;

export class Generator {

    protected static readonly optimus = new Optimus(config.optimus.prime, config.optimus.inverse, config.optimus.random);

    @MemoizeExpiring(30000)
    static async getDelay(): Promise<number> {
        return Account.calculateDelay();
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
        return Caching.getSkinData(uuid);
    }


    protected static async saveSkin(data: SkinData, options: GenerateOptions, client: ClientInfo) {
        const id = await this.makeNewSkinId();
        const skin: ISkinDocument = new Skin({
            id: id,

        } as ISkinDocument)

    }

    /// DUPLICATE CHECKS

    protected static async findDuplicateFromUrl(url: string): Promise<ISkinDocument> {
        if (!url || url.length < 8 || !url.startsWith("http")) {
            return null;
        }

        const mineskinUrlResult = MINESKIN_URL_REGEX.exec(url);
        if (!!mineskinUrlResult && mineskinUrlResult.length >= 3) {
            const mineskinId = parseInt(mineskinUrlResult[2]);
            const existingSkin = await Skin.findOne({ id: mineskinId }).exec();
            if (existingSkin) {
                existingSkin.duplicate++;
                try {
                    DUPLICATES_METRIC
                        .tag("server", config.server)
                        .tag("source", DuplicateSource.MINESKIN_URL)
                        .inc();
                } catch (e) {
                    Sentry.captureException(e);
                }
                return await existingSkin.save();
            } else {
                return null;
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
                existingSkin.duplicate++;
                try {
                    DUPLICATES_METRIC
                        .tag("server", config.server)
                        .tag("source", DuplicateSource.TEXTURE_URL)
                        .inc();
                } catch (e) {
                    Sentry.captureException(e);
                }
                return await existingSkin.save();
            } else {
                return null;
            }
        }

        return null;
    }


    /// GENERATE URL

    static async generateFromUrlAndSave(url: string, options: GenerateOptions, client: ClientInfo): Promise<ISkinDocument> {
        const duplicate = await this.findDuplicateFromUrl(url);
        if (duplicate) {
            return duplicate;
        }

        const data = await this.generateFromUrl(url, options.model);
        await this.saveSkin(data, options, client);

    }

    protected static async generateFromUrl(originalUrl: string, model: SkinModel): Promise<SkinData> {
        console.log(info("[Generator] Generating from url"));

        let account: IAccountDocument;
        try {
            const url = await this.followUrlToImage(originalUrl);

            account = await this.getAndAuthenticateAccount();

            const body = {
                variant: model,
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
                    throw new GeneratorError(GenError.SKIN_CHANGE_FAILED, "Failed to change skin", account, err);
                }
                throw err;
            })

            return await this.getSkinData(account);
        } catch (e) {
            await this.handleGenerateError(e, account);
            throw e;
        }

    }

    protected static async followUrlToImage(urlStr: string): Promise<string> {
        if (!urlStr) return urlStr;
        try {
            const url = URL.parse(urlStr, false);
            if (URL_FOLLOW_WHITELIST.includes(url.host)) {
                const followResponse = await Requests.axiosInstance.request({
                    method: "GET",
                    url: url.href,
                    maxRedirects: MAX_FOLLOW_REDIRECTS,
                    headers: {
                        "User-Agent": "MineSkin"
                    }
                });
                // https://github.com/axios/axios/issues/390
                return followResponse.request.res.responseUrl;
            }
        } catch (e) {
            Sentry.captureException(e);
        }
        return urlStr;
    }

    /// GENERATE UPLOAD

    static async generateFromUploadAndSave(buffer: Buffer, options: GenerateOptions, client: ClientInfo): Promise<ISkinDocument> {
        //TODO
    }

    protected static async generateFromUpload(buffer: Buffer, model: SkinModel): Promise<GeneratorResult> {
        console.log(info("[Generator] Generating from upload"));

        let account: IAccountDocument;
        try {
            account = await this.getAndAuthenticateAccount();

            const body = new FormData();
            body.append("variant", model);
            body.append("file", new Blob([buffer], { type: "image/png" }), {
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
            }).catch(err=>{
                if (err.response) {
                    throw new GeneratorError(GenError.SKIN_CHANGE_FAILED, "Failed to change skin", account, err);
                }
                throw err;
            });

            return this.getSkinData(account);
        } catch (e) {
            await this.handleGenerateError(e, account);
            throw e;
        }
    }

    /// GENERATE USER

    protected static async generateFromUser() {
        //TODO
    }

    /// AUTH

    protected static async getAndAuthenticateAccount(): Promise<IAccountDocument> {
        let account: IAccountDocument = await Account.findUsable();
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

    protected static async handleGenerateSuccess(account: IAccountDocument): Promise<IAccountDocument> {
        if (!account) return account;
        try {
            account.errorCounter = 0;
            account.successCounter++;
            account.totalSuccessCounter++;
            return account.save();
        } catch (e1) {
            Sentry.captureException(e1);
        }
    }

    protected static async handleGenerateError(e: any, account: IAccountDocument): Promise<IAccountDocument> {
        if (!account) return account;
        try {
            account.successCounter = 0;
            account.errorCounter++;
            account.totalErrorCounter++;
            if (e instanceof AuthenticationError) {
                account.forcedTimeoutAt = Math.floor(Date.now() / 1000);
                console.warn(warn("[Generator] Account #" + account.id + " forced timeout"));
                account.updateRequestServer(null);
            }
            return account.save();
        } catch (e1) {
            Sentry.captureException(e1);
        }
        return account;
    }

}

export interface GeneratorResult {
//TODO
}

export enum GenError {
    FAILED_TO_CREATE_ID = "failed_to_create_id",
    NO_ACCOUNT_AVAILABLE = "no_account_available",
    SKIN_CHANGE_FAILED = "skin_change_failed",
}

export class GeneratorError extends MineSkinError {
    constructor(code: GenError, msg: string, public account?: IAccountDocument, public details?: any) {
        super(code, msg);
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

console.log("Optimus Test:", Generator.optimus.encode(Math.floor(Date.now() / 10)));
