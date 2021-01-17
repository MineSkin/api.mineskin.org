import { Document, Model } from "mongoose";
import { access } from "fs";

export interface SecurityQuestion {
    id: string;
    answer: string;
}

export enum AccountType {
    INTERNAL = "internal",
    EXTERNAL = "external",
}

export enum AccessTokenSource {
    LOGIN_MOJANG = "login_mojang",
    REFRESH_MOJANG = "refresh_mojang",

    LOGIN_MICROSOFT = "login_microsoft",
    REFRESH_MICROSOFT = "refresh_microsoft"
}

export interface IAccountDocument extends Document {
    id: number | any;
    username: string;
    uuid: string;
    playername?: string;
    authInterceptorEnabled?: boolean;
    /**@deprecated**/
    password?: string;
    /**@deprecated**/
    passwordOld?: string;
    passwordNew?: string;
    /**@deprecated**/
    security?: string;
    multiSecurity?: SecurityQuestion[];
    microsoftAccount?: boolean;
    microsoftUserId?: string;
    microsoftAccessToken?: string;
    microsoftRefreshToken?: string;
    minecraftXboxUsername?: string;
    lastSelected?: number;
    timeAdded?: number;
    lastUsed?: number;
    enabled: boolean;
    errorCounter: number;
    successCounter: number;
    totalErrorCounter: number;
    totalSuccessCounter: number;
    lastErrorCode: string;
    forcedTimeoutAt: number;
    lastTextureUrl: string;
    sameTextureCounter: number;
    accessToken: string;
    accessTokenExpiration: number;
    accessTokenSource: AccessTokenSource;
    clientToken: string;
    requestIp: string;
    requestServer?: string;
    lastRequestServer: string;
    type: AccountType;
    discordUser?: string;
    discordMessageSent?: boolean;
    sendEmails?: boolean

    getOrCreateClientToken(): string;

    updateRequestServer(newRequestServer?: string): void;

    authenticationHeader(): string;

    toSimplifiedString(): string;
}

export interface IAccountModel extends Model<IAccountDocument> {
    findUsable(): Promise<IAccountDocument|undefined>;

    countGlobalUsable(): Promise<number>;

    calculateDelay(): Promise<number>;
}
