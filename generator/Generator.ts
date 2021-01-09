import { Account, Skin } from "../database/schemas";
import { MemoizeExpiring } from "typescript-memoize";
import { DUPLICATES_METRIC, error, imageHash, info, random32BitNumber, stripUuid, warn } from "../util";
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
import { Temp, TempFile, UPL_DIR, URL_DIR } from "./Temp";
import { AxiosResponse } from "axios";
import imageSize from "image-size";
import { promises as fs } from "fs";
import * as fileType from "file-type";
import { UploadedFile } from "express-fileupload";


const config: Config = require("../config");

const MAX_ID_TRIES = 10;

const MINESKIN_URL_REGEX = /https?:\/\/minesk(\.in|in\.org)\/([0-9]+)/i;
const MINECRAFT_TEXTURE_REGEX = /https?:\/\/textures\.minecraft\.net\/texture\/([0-9a-z]+)/i;

const URL_FOLLOW_WHITELIST = [
    "novask.in",
    "imgur.com"
];
const MAX_FOLLOW_REDIRECTS = 5;

const MAX_IMAGE_SIZE = 20000; // about 70x70px at 32bit
const ALLOWED_IMAGE_TYPES = ["image/png"];

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


    protected static async saveSkin(data: SkinData, options: GenerateOptions, client: ClientInfo): Promise<ISkinDocument> {
        const id = await this.makeNewSkinId();
        const skin: ISkinDocument = new Skin({
            id: id,

        } as ISkinDocument)

    }

    /// DUPLICATE CHECKS

    protected static async findDuplicateFromUrl(url: string, options: GenerateOptions): Promise<ISkinDocument> {
        if (!url || url.length < 8 || !url.startsWith("http")) {
            return null;
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
                ],
                name: options.name, model: options.model, visibility: options.visibility
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

    protected static async findDuplicateFromImageHash(hash: string, options: GenerateOptions): Promise<ISkinDocument> {
        if (!hash || hash.length < 30) {
            return null;
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
                    .inc();
            } catch (e) {
                Sentry.captureException(e);
            }
            return await existingSkin.save();
        } else {
            return null;
        }
    }

    /// GENERATE URL

    static async generateFromUrlAndSave(url: string, options: GenerateOptions, client: ClientInfo): Promise<ISkinDocument> {
        const data = await this.generateFromUrl(url, options);
        if (data.duplicate) {
            return data.duplicate;
        }
        if (data.data) {
            return await this.saveSkin(data.data, options, client);
        }
        // shouldn't ever get here
        throw new MineSkinError('unknown', "Something went wrong while generating");
    }

    protected static async generateFromUrl(originalUrl: string, options: GenerateOptions): Promise<GenerateResult> {
        console.log(info("[Generator] Generating from url"));

        let account: IAccountDocument = null;
        let tempFile: TempFile = null;
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
            const urlDuplicate = await this.findDuplicateFromUrl(url, options);
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
                throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to download image", 500, null, e);
            }

            // Validate downloaded image file
            const tempFileValidation = await this.validateTempFile(tempFile, options);
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

            return {
                data: await this.getSkinData(account)
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

    protected static async followUrl(urlStr: string): Promise<AxiosResponse | undefined> {
        try {
            const url = URL.parse(urlStr, false);
            if (URL_FOLLOW_WHITELIST.includes(url.host)) {
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

    static async generateFromUploadAndSave(file: UploadedFile, options: GenerateOptions, client: ClientInfo): Promise<ISkinDocument> {
        const data = await this.generateFromUpload(file, options);
        if (data.duplicate) {
            return data.duplicate;
        }
        if (data.data) {
            return await this.saveSkin(data.data, options, client);
        }
        // shouldn't ever get here
        throw new MineSkinError('unknown', "Something went wrong while generating");
    }

    protected static async generateFromUpload(file: UploadedFile, options: GenerateOptions): Promise<GenerateResult> {
        console.log(info("[Generator] Generating from upload"));

        let account: IAccountDocument = null;
        let tempFile: TempFile = null;
        try {
            // Copy uploaded file
            tempFile = await Temp.file({
                dir: UPL_DIR
            });
            try {
                await Temp.copyUploadedImage(file, tempFile);
            } catch (e) {
                throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to upload image", 500, null, e);
            }

            // Validate uploaded image file
            const tempFileValidation = await this.validateTempFile(tempFile, options);
            if (tempFileValidation.duplicate) {
                // found a duplicate
                return tempFileValidation;
            }

            /// Run generation for new skin

            account = await this.getAndAuthenticateAccount();

            const body = new FormData();
            body.append("variant", options.model);
            body.append("file", new Blob([tempFileValidation.buffer], { type: "image/png" }), {
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

            return {
                data: await this.getSkinData(account)
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
        return account;
    }

    protected static async handleGenerateError(e: any, account?: IAccountDocument): Promise<IAccountDocument> {
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


    /// VALIDATION


    protected static getUrlFromResponse(response: AxiosResponse): string {
        if (!response) return undefined;
        return response.request.res.responseUrl;
    }

    protected static getSizeFromResponse(response: AxiosResponse): number {
        if (!response) return undefined;
        return response.headers["content-length"];
    }

    protected static getContentTypeFromResponse(response: AxiosResponse): string {
        if (!response) return undefined;
        return response.headers["content-type"];
    }

    protected static async validateTempFile(tempFile: TempFile, options: GenerateOptions): Promise<TempFileValidationResult> {
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

        // Get the hash
        const imgHash = await imageHash(imageBuffer);
        // Check duplicate from hash
        const hashDuplicate = await this.findDuplicateFromImageHash(imgHash, options);
        if (hashDuplicate) {
            return {
                duplicate: hashDuplicate
            };
        }

        return {
            buffer: imageBuffer
        };
    }


}

interface GenerateResult {
    duplicate?: ISkinDocument;
    data?: SkinData;
}

interface TempFileValidationResult extends GenerateResult {
    buffer?: Buffer;
}

export enum GenError {
    FAILED_TO_CREATE_ID = "failed_to_create_id",
    NO_ACCOUNT_AVAILABLE = "no_account_available",
    SKIN_CHANGE_FAILED = "skin_change_failed",
    INVALID_IMAGE = "invalid_image",
    INVALID_IMAGE_URL = "invalid_image_url",
    INVALID_IMAGE_UPLOAD = "invalid_image_upload"
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
