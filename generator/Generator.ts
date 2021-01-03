import { Account } from "../database/schemas";
import { MemoizeExpiring } from "typescript-memoize";
import { stripUuid } from "../util";
import { IAccountDocument } from "../types";
import { Caching } from "./Caching";
import { SkinData } from "../types/SkinData";

export class Generator {

    @MemoizeExpiring(30000)
    static async getDelay(): Promise<number> {
        return Account.calculateDelay();
    }

    static async getSkinData(accountOrUuid: IAccountDocument | { uuid: string }): Promise<SkinData> {
        const uuid = stripUuid(accountOrUuid.uuid);
        return Caching.getSkinData(uuid);
    }

    static async generateFromUrl() {
        //TODO
    }

    static async generateFromUpload() {
        //TODO
    }

    static async generateFromUser() {
        //TODO
    }

}
