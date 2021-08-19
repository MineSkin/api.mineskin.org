import { Document, Model } from "mongoose";
import { Maybe } from "../../util";
import { MojangSecurityAnswer } from "../../generator/Authentication";
import { Bread } from "../Bread";

export interface SecurityQuestion extends MojangSecurityAnswer {
}

export enum AccountType {
    MOJANG = "mojang",
    MICROSOFT = "microsoft"
}

export enum AccessTokenSource {
    LOGIN_MOJANG = "login_mojang",
    REFRESH_MOJANG = "refresh_mojang",

    LOGIN_MICROSOFT = "login_microsoft",
    REFRESH_MICROSOFT = "refresh_microsoft",

    USER_LOGIN_MOJANG = "user_login_mojang",
    USER_LOGIN_MICROSOFT = "user_login_microsoft"
}

export interface IAccountDocument extends Document {
    id: number | any;
    /**@deprecated legacy email **/
    username: string;
    email?: string;
    /** player uuid **/
    uuid: string;
    /** player name **/
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
    accountType?: AccountType;
    /**@deprecated**/
    microsoftAccount?: boolean;
    microsoftUserId?: string;
    microsoftUserHash?: string;
    microsoftAccessToken?: string;
    microsoftRefreshToken?: string;
    minecraftXboxUsername?: string;
    microsoftXSTSToken?: string;
    lastSelected?: number;
    timeAdded?: number;
    lastUsed?: number;
    enabled: boolean;
    errorCounter: number;
    successCounter: number;
    totalErrorCounter: number;
    totalSuccessCounter: number;
    lastGenerateSuccess: number;
    lastErrorCode: string;
    forcedTimeoutAt: number;
    lastTextureUrl: string;
    sameTextureCounter: number;
    accessToken: string;
    accessTokenExpiration: number;
    accessTokenSource: AccessTokenSource;
    clientToken: string;
    requestIp: string;
    requestServer?: string | null;
    lastRequestServer: string;
    type: string;
    discordUser?: string;
    discordMessageSent?: boolean;
    sendEmails?: boolean
    emailSent?: boolean;
    ev?: number;

    getOrCreateClientToken(): string;

    updateRequestServer(newRequestServer: string | null): void;

    getEmail(): string;

    getAccountType(): AccountType;

    authenticationHeader(): string;

    toSimplifiedString(): string;
}

export interface IAccountModel extends Model<IAccountDocument> {
    findUsable(bread?: Bread): Promise<IAccountDocument | undefined>;

    countGlobalUsable(): Promise<number>;

    calculateMinDelay(): Promise<number>;

    getAccountsPerServer(accountType?: string): Promise<{ server: string, count: number }[]>;

    getPreferredAccountServer(accountType?: string): Promise<Maybe<string>>;
}
