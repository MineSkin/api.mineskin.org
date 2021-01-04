import { Account, Skin } from "../database/schemas";
import { MemoizeExpiring } from "typescript-memoize";
import { random32BitNumber, stripUuid } from "../util";
import { IAccountDocument, MineSkinError } from "../types";
import { Caching } from "./Caching";
import { SkinData } from "../types/SkinData";
import { Config } from "../types/Config";
import { SkinModel } from "../types/ISkinDocument";
import Optimus from "optimus-js";
import { AuthError } from "./Authentication";
import * as crypto from "crypto";

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

    static async generateFromUrl(url: string, model: SkinModel) {
        //TODO
    }

    static async generateFromUpload(buffer: Buffer, model: SkinModel) {
        //TODO
    }

    static async generateFromUser() {
        //TODO
    }

}

export enum GenError {
    FAILED_TO_CREATE_ID = "failed_to_create_id",
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
