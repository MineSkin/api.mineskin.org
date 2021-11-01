import { SkinModel, SkinVariant } from "./db/ISkinDocument";
import { ProfileProperty } from "./ProfileResponse";
import { DelayInfo } from "./DelayInfo";

export interface SkinInfoTextureUrls {
    skin: string;
    cape?:string;
}

export interface SkinInfoTexture extends Omit<ProfileProperty, "name"> {
    url: string;
    urls: SkinInfoTextureUrls;
}

export interface SkinInfoData {
    uuid: string;
    texture: SkinInfoTexture;
}

export interface SkinInfo {
    id: number;
    idStr: string;
    uuid: string;
    hash: string;
    name: string;
    /**@deprecated**/
    model: SkinModel;
    variant: SkinVariant;
    data: SkinInfoData;
    timestamp: number;
    duration: number;
    /**@deprecated**/
    accountId: number;
    account: number;
    server: string;
    private: boolean;
    views: number;
    duplicate?: boolean;
    nextRequest?: number;
    delayInfo?: DelayInfo;
}
