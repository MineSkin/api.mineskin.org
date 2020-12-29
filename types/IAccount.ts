import { Document } from "mongoose";

export interface SecurityQuestion {
    id: string;
    answer: string;
}

export enum AccountType {
    INTERNAL = "internal",
    EXTERNAL = "external",
}

export interface IAccount extends Document {
    id: number | any;
    username: string;
    uuid: string;
    playername?: string;
    authInterceptorEnabled?: boolean;
    password?: string;
    passwordOld?: string;
    passwordNew?: string;
    security?: string;
    multiSecurity?: SecurityQuestion[];
    microsoftAccount?: boolean;
    microsoftUserId?: string;
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
    accessTokenSource: string;
    clientToken: string;
    requestIp: string;
    requestServer: string;
    lastRequestServer: string;
    type: AccountType;
    discordUser?: string;
    discordMessageSent?: boolean;
    sendEmails?: boolean
}
