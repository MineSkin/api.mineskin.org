import { Account, Skin } from "../database/schemas";
import { MemoizeExpiring } from "typescript-memoize";
import { error, info, random32BitNumber, stripUuid, warn } from "../util";
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


const config: Config = require("../config");

const MAX_ID_TRIES = 10;

export class Generator {

    protected static readonly optimus = new Optimus(config.optimus.prime, config.optimus.inverse, config.optimus.random);

    @MemoizeExpiring(30000)
    static async getDelay(): Promise<number> {
        return Account.calculateDelay();
    }

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
        const skin: ISkinDocument = new Skin({
            //TODO
        } as ISkinDocument)

    }

    static async generateFromUrlAndSave(url: string, options: GenerateOptions, client: ClientInfo): Promise<ISkinDocument> {
        const data = await this.generateFromUrl(url, options.model);
        await this.saveSkin(data, options, client);
    }

    protected static async generateFromUrl(url: string, model: SkinModel): Promise<SkinData> {
        console.log(info("[Generator] Generating from url"));

        let account;
        try {
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
            });
            if (!Requests.isOk(skinResponse)) {
                throw new GeneratorError(GenError.SKIN_CHANGE_FAILED, "Failed to change skin", account);
            }

            return await this.getSkinData(account);
        } catch (e) {
            await this.handleGenerateError(e, account);
            throw e;
        }

    }

    static async generateFromUploadAndSave(buffer: Buffer, options: GenerateOptions, client: ClientInfo): Promise<ISkinDocument> {
        //TODO
    }

    protected static async generateFromUpload(buffer: Buffer, model: SkinModel): Promise<GeneratorResult> {
        console.log(info("[Generator] Generating from upload"));

        let account;
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
            });
            if (!Requests.isOk(skinResponse)) {
                throw new GeneratorError(GenError.SKIN_CHANGE_FAILED, "Failed to change skin", account);
            }

            return this.getSkinData(account);
        } catch (e) {
            await this.handleGenerateError(e, account);
            throw e;
        }
    }

    protected static async generateFromUser() {
        //TODO
    }

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

console.log("Optimus Test:", Generator.optimus.encode(Math.floor(Date.now() / 10)));
