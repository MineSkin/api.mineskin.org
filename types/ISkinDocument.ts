import { Document, Model, model } from "mongoose";
import { SkinInfo } from "./SkinInfo";

export enum SkinModel {
    UNKNOWN = "unknown",
    CLASSIC = "steve",
    SLIM = "slim"
}


export enum SkinVisibility {
    PUBLIC = 0,
    PRIVATE = 1,
}

export interface ISkinDocument extends Document {
    id: number | any;
    hash: string;
    name: string;
    uuid: string;
    model: SkinModel | any;
    visibility: SkinVisibility;
    value: string;
    signature: string;
    url: string;
    skinId: string;
    skinTextureId: string;
    textureHash: string;
    capeUrl: string;
    time: number;
    generateDuration: number;
    account: number;
    type: string;
    duplicate: number;
    views: number;
    via: string;
    server: string;
    ua: string;
    apiVer: string;
    testerRequest: boolean;
    testerMismatchCounter: number;

    toResponseJson(): SkinInfo;
}

export interface ISkinModel extends Model<ISkinDocument> {
    findExistingForHash(hash: string, name: string, model: SkinModel, visibility: SkinVisibility): Promise<ISkinDocument>;
    findExistingForTextureUrl(url: string, name: string, model: SkinModel, visibility: SkinVisibility): Promise<ISkinDocument>;
}
