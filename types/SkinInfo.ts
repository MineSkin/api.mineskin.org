import { SkinModel } from "./ISkinDocument";
import { ProfileProperty } from "./ProfileResponse";

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
    name: string;
    model: SkinModel;
    data: SkinInfoData;
    timestamp: number;
    duration: number;
    accountId: number;
    server: string;
    private: boolean;
    views: number;
    nextRequest?: number;
}
