import { Model, UpdateWriteOpResult } from "mongoose";
import { SkinInfo } from "../SkinInfo";
import { Maybe } from "../../util";

/**@deprecated**/
export enum SkinModel {
    UNKNOWN = "unknown",
    CLASSIC = "steve",
    SLIM = "slim"
}

export enum SkinVariant {
    UNKNOWN = "unknown",
    CLASSIC = "classic",
    SLIM = "slim"
}


export enum SkinVisibility {
    PUBLIC = 0,
    PRIVATE = 1,
}

export enum GenerateType {
    UPLOAD = "upload",
    URL = "url",
    USER = "user"
}

export interface ISkinDocument {
    /** Unique numeric ID for this skin **/
    id: number | any;
    skinUuid?: string;

    /** Hash of the texture image **/
    hash: string;
    /** UUID of the skin - Not unique - random for url/upload or user uuid **/
    uuid: string;

    /** Custom path given by the user **/
    name?: string;
    /** Model of the skin **/
    model: SkinModel | any;
    variant: SkinVariant;
    /** Selected visibility **/
    visibility: SkinVisibility;

    /** Texture Value **/
    value: string;
    /** Texture Signature **/
    signature: string;
    /** Minecraft texture url **/
    url: string;
    /** Hash part of the minecraft texture url **/
    minecraftTextureHash?: string;
    /** UUID of the skin info returned by mojang **/
    minecraftSkinId?: string;
    /** @deprecated **/
    skinId: string;
    /** @deprecated **/
    skinTextureId: string;
    /** Hash of the texture image downloaded from mojang **/
    textureHash: string;
    capeUrl?: string;

    /** Time of generating the skin (seconds) **/
    time: number;
    /** Time it took to generate (milliseconds) **/
    generateDuration: number;
    /** ID of the account that generated the skin (only for url/upload) **/
    account?: number;
    breadcrumb?: string;
    /** Generation type **/
    type: GenerateType;
    /** Number of times the same skin was requested on this existing entry **/
    duplicate: number;
    /** Number of times this skin has been viewed **/
    views: number;
    /** Where this skin was generated from (api/website) **/
    via?: string;
    /** Server this skin was generated on **/
    server?: string;
    /** User-Agent of generation request **/
    ua?: string;
    /** Key used for request **/
    apiKey?: string;
    /** @deprecated **/
    apiVer?: string;

    testerRequest?: boolean;
    testerMismatchCounter?: number;
    hv?: number;

    getUuid(): string;

    getHash(): Promise<string>;

    getVariant(): SkinVariant;

    toResponseJson(delay?: number): SkinInfo;
}

export interface ISkinModel extends Model<ISkinDocument> {
    findForId(id: number): Promise<Maybe<ISkinDocument>>;

    findForUuid(uuid: string): Promise<Maybe<ISkinDocument>>;

    attachTesterResult(id: number, server: string, mismatchCount: number): Promise<ISkinDocument>;

    incViews(uuid: string): Promise<UpdateWriteOpResult>;
}
