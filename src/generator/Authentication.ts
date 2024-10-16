import { Requests } from "./Requests";
import * as Sentry from "@sentry/node";
import * as XboxLiveAuth from "@xboxreplay/xboxlive-auth"
import { AuthenticateResponse, ExchangeRpsTicketResponse } from "@xboxreplay/xboxlive-auth"
import qs from "querystring";
import { AxiosResponse } from "axios";
import { getConfig } from "../typings/Configs";
import { debug, warn } from "../util/colors";
import { Bread } from "../typings/Bread";
import { Notifications } from "../util/Notifications";
import { Account, IAccountDocument } from "@mineskin/database";
import { epochSeconds, Maybe, toEpochSeconds } from "../util";
import { MineSkinMetrics } from "../util/metrics";
import { MicrosoftAuthInfo } from "../typings/MicrosoftAuthInfo";
import { Generator } from "./Generator";
import { AccessTokenSource, AccountType, ErrorSource, MineSkinError } from "@mineskin/types";
import { Accounts } from "./Accounts";

const ACCESS_TOKEN_EXPIRATION_MOJANG = 86360;
const ACCESS_TOKEN_EXPIRATION_MICROSOFT = 86360;

const ACCESS_TOKEN_EXPIRATION_THRESHOLD = 20 * 60;

const MC_XSTSRelyingParty = 'rp://api.minecraftservices.com/'
const XBOX_XSTSRelyingParty = 'http://xboxlive.com'

/**@deprecated**/
export class Mojang {

    /**@deprecated**/
    public static async authenticate(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        if (account.accountType !== AccountType.MOJANG) {
            throw new AuthenticationError(AuthError.UNSUPPORTED_ACCOUNT, "Can't authenticate microsoft account via mojang auth", {account});
        }

        if (!account.accessToken) { // Needs login
            console.log(warn(bread?.breadcrumb + " [Auth] Account #" + account.id + " doesn't have access token"));
            return await Mojang.login(account, bread);
        }

        // Check token expiration
        if (account.accessTokenExpiration && account.accessTokenExpiration - Math.round(Date.now() / 1000) < ACCESS_TOKEN_EXPIRATION_THRESHOLD) {
            console.log(debug(bread?.breadcrumb + " [Auth] (#" + account.id + ") Force-refreshing accessToken, since it will expire in less than 20 minutes"));
            return await Mojang.refreshAccessTokenOrLogin(account, bread);
        }

        // Validate token which shouldn't be expired yet
        if (await Mojang.validateAccessToken(account, bread)) {
            // Still valid!
            console.log(debug(bread?.breadcrumb + " [Auth] (#" + account.id + ") Token still valid!"));
            return account;
        }

        // Fallback to refresh / login
        return await Mojang.refreshAccessTokenOrLogin(account, bread);
    }

    /// LOGIN

    /**@deprecated**/
    static async loginWithCredentials(email: string, password: string, clientToken: string): Promise<MojangLoginResponse> {
        const body = {
            agent: {
                name: "Minecraft",
                version: 1
            },
            username: email,
            password: password,
            clientToken: clientToken,
            requestUser: true,
            _timestamp: Date.now()
        };
        const authResponse = await Requests.mojangAuthRequest({
            method: "POST",
            url: "/authenticate",
            data: JSON.stringify(body)
        });
        const authBody = authResponse.data;
        return authBody as MojangLoginResponse;
    }

    /**@deprecated**/
    static async login(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        const config = await getConfig();
        if (account.accountType !== AccountType.MOJANG) {
            throw new AuthenticationError(AuthError.UNSUPPORTED_ACCOUNT, "Can't login microsoft account via mojang auth", {account});
        }

        throw new Error("not implemented");
    }

    /// TOKENS

    /**@deprecated**/
    static async validateAccessToken(account: IAccountDocument, bread?: Bread): Promise<boolean> {
        if (account && account.accountType !== AccountType.MOJANG) {
            throw new AuthenticationError(AuthError.UNSUPPORTED_ACCOUNT, "Can't validate microsoft account access token via mojang auth", {account});
        }

        throw new Error("not implemented");
    }

    /**@deprecated**/
    static async refreshAccessTokenOrLogin(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        throw new Error("not implemented");
    }

    /**@deprecated**/
    static async refreshAccessToken(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        const config = await getConfig();
        if (account.accountType !== AccountType.MOJANG) {
            throw new AuthenticationError(AuthError.UNSUPPORTED_ACCOUNT, "Can't refresh microsoft account access token via mojang auth", {account});
        }

        throw new Error("not implemented");
    }

    /// CHALLENGES

    /**@deprecated**/
    static async getChallenges(accessToken: string): Promise<MojangChallengesResponse> {
        // Check if location is secured
        const locationResponse: boolean = await Requests.mojangApiRequest({
            method: "GET",
            url: "/user/security/location",
            headers: {
                "Authorization": `Bearer ${ accessToken }`
            }
        }).then(res => {
            return Requests.isOk(res);
        }).catch(() => {
            return false;
        })
        if (locationResponse) {
            // Already answered
            return {
                needSolving: false
            };
        }

        // Get security questions
        const challengesResponse = await Requests.mojangApiRequest({
            method: "GET",
            url: "/user/security/challenges",
            headers: {
                "Authorization": `Bearer ${ accessToken }`
            }
        });
        const challengesBody = challengesResponse.data;
        if (!challengesBody || challengesBody.length <= 0) {
            // Probably no questions?
            return {
                needSolving: false
            };
        }
        const questions: MojangSecurityQuestion[] = challengesBody;

        return {
            needSolving: true,
            questions: questions
        }
    }

    /**@deprecated**/
    static async submitChallengeAnswers(accessToken: string, answers: MojangSecurityAnswer[]): Promise<AxiosResponse<any>> {
        return await Requests.mojangApiRequest({
            method: "POST",
            url: "/user/security/location",
            headers: {
                "Authorization": `Bearer ${ accessToken }`
            },
            data: answers
        });
    }

    /**@deprecated**/
    static async completeChallenges(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        throw new Error("not implemented");
    }


}

export class Microsoft {

    public static async authenticate(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        if (account.accountType !== AccountType.MICROSOFT) {
            throw new AuthenticationError(AuthError.UNSUPPORTED_ACCOUNT, "Can't authenticate non-microsoft account via microsoft auth", {account});
        }

        if (!account.accessToken) { // Needs login
            //return await Microsoft.login(account, bread);
            if (account.microsoftAuth?.auth?.refreshToken) {
                // try to refresh token
                console.log(debug(bread?.breadcrumb + " [Auth] (" + account.uuid + ") Trying to get a new access token"));
                return await Microsoft.refreshAccessTokenOrLogin(account, bread);
            }
            throw new AuthenticationError(AuthError.MISSING_CREDENTIALS, "Account has no access token", {account});
        }

        // Check token expiration
        if (account.accessTokenExpiration && account.accessTokenExpiration - Math.round(Date.now() / 1000) < ACCESS_TOKEN_EXPIRATION_THRESHOLD) {
            console.log(debug(bread?.breadcrumb + " [Auth] (" + account.uuid + ") Force-refreshing accessToken, since it will expire in less than 20 minutes"));
            return await Microsoft.refreshAccessTokenOrLogin(account, bread);
        }

        try {
            // Try to use the access token
            if (await Microsoft.checkGameOwnership(account.accessToken)) {
                // Still valid!
                return account;
            }
            // const profile = await Caching.getProfileByAccessToken(account.accessToken);
            // if (profile && profile.id?.length >= 32) {
            //     // Still valid!
            //     return account;
            // }
        } catch (e) {
            Sentry.captureException(e);
        }

        // Fallback to refresh / login
        return await Microsoft.refreshAccessTokenOrLogin(account, bread);
    }

    /**@deprecated**/
    static async login(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        const config = await getConfig();
        if (account.accountType !== AccountType.MICROSOFT) {
            throw new AuthenticationError(AuthError.UNSUPPORTED_ACCOUNT, "Can't login non-microsoft account via microsoft auth", {account});
        }

        throw new AuthenticationError(AuthError.MISSING_CREDENTIALS, "Account has no password", {account});
    }

    static async refreshAccessTokenOrLogin(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        try {
            return await Microsoft.refreshAccessToken(account, bread);
        } catch (e) {
            if (e instanceof AuthenticationError) {
                if (e.code === AuthError.MICROSOFT_REFRESH_FAILED) {
                    // Couldn't refresh, attempt to login
                    return await Microsoft.login(account, bread);
                }
            }
            throw e;
        }
    }

    static async refreshAccessToken(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        const config = await getConfig();
        if (account.accountType !== AccountType.MICROSOFT) {
            throw new AuthenticationError(AuthError.UNSUPPORTED_ACCOUNT, "Can't refresh token of non-microsoft account via microsoft auth", {account});
        }
        if (!account.microsoftAuth?.auth.refreshToken) {
            throw new AuthenticationError(AuthError.MICROSOFT_REFRESH_FAILED, "Account has no refresh token", {account});
        }

        console.log(debug(bread?.breadcrumb + " [Auth] Refreshing " + account.toSimplifiedString()));
        const newMinecraftAccessToken = await Microsoft.refreshXboxAccessToken(account.microsoftAuth.auth.refreshToken, true, xboxInfo => {
            account.microsoftAuth = xboxInfo.msa as MicrosoftAuthInfo;
        }).catch(err => {
            if (err.response || err.name === "XboxReplayError") {
                console.warn(err);
                Sentry.captureException(err);
                throw new AuthenticationError(AuthError.MICROSOFT_REFRESH_FAILED, "Failed to refresh token via microsoft", {
                    account,
                    error: err
                });
            }
            throw err;
        })
        console.log(debug(bread?.breadcrumb + " [Auth] Refreshed access token for " + account.toSimplifiedString()));
        account.accessToken = newMinecraftAccessToken;
        account.accessTokenExpiration = Math.round(Date.now() / 1000) + ACCESS_TOKEN_EXPIRATION_MICROSOFT;
        account.accessTokenSource = AccessTokenSource.REFRESH_MICROSOFT;
        if (!account.requestServer || !(await Generator.getRequestServers()).includes(account.requestServer)) {
            Accounts.updateAccountRequestServer(account, config.server);
        }
        console.log(debug(bread?.breadcrumb + " [Auth] (#" + account.id + ") Request server set to " + account.requestServer));

        return await account.save();
    }

    // based on https://github.com/PrismarineJS/node-minecraft-protocol/blob/master/src/client/microsoftAuth.js
    /**
     * @deprecated
     */
    static async loginWithEmailAndPassword(email: string, password: string, xboxInfoConsumer?: (info: XboxInfo) => void): Promise<string> {
        // https://login.live.com/oauth20_authorize.srf
        const preAuthResponse = await XboxLiveAuth.preAuth();
        console.log("preAuth")
        // console.log(JSON.stringify(preAuthResponse))
        const loginResponse = await XboxLiveAuth.logUser(preAuthResponse, {email, password});
        console.log("logUser")
        // console.log(JSON.stringify(loginResponse));

        const xboxUserId = loginResponse.user_id;
        const xboxAccessToken = loginResponse.access_token;
        const xboxRefreshToken = loginResponse.refresh_token;

        const identityResponses: MicrosoftIdentities = await Microsoft.exchangeRpsTicketForIdentities(xboxAccessToken);
        console.log("identities");
        // console.log(identityResponses)
        const mcIdentity = identityResponses.mc;
        const xboxIdentity = identityResponses.xbox;

        const userHash = mcIdentity.DisplayClaims.xui[0].uhs;
        const XSTSToken = mcIdentity.Token;

        const xboxLoginResponse = await Microsoft.loginToMinecraftWithXbox(userHash, XSTSToken);
        const minecraftXboxUsername = xboxLoginResponse.username;

        if (xboxInfoConsumer) {
            try {
                xboxInfoConsumer({
                    accessToken: xboxAccessToken,
                    refreshToken: xboxRefreshToken,
                    userId: xboxUserId,
                    XSTSToken: XSTSToken,
                    userHash: userHash,
                    username: minecraftXboxUsername
                });
            } catch (e) {
                console.warn(e);
                Sentry.captureException(e);
            }
        }
        return xboxLoginResponse.access_token;
    }

    static async loginWithXboxCode(code: string, xboxInfoConsumer?: (info: XboxInfo) => void): Promise<string> {
        const config = await getConfig();
        // const form = {
        //     "client_id": /*"00000000402b5328"*/"000000004C12AE6F",
        //     "code": code,
        //     "grant_type": "authorization_code",
        //     "redirect_uri": "https://login.live.com/oauth20_desktop.srf",
        //     "scope": "service::user.auth.xboxlive.com::MBI_SSL"
        // }
        const form = {
            "client_id": config.microsoft.clientId,
            "client_secret": config.microsoft.clientSecret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": `https://${ config.server }.api.mineskin.org/accountManager/microsoft/oauth/callback`
        }
        return Microsoft.authenticateXboxWithFormData(form, xboxInfoConsumer);
    }

    static async exchangeRpsTicketForIdentities(rpsTicket: string): Promise<MicrosoftIdentities & {
        token: ExchangeRpsTicketResponse
    }> {
        if (!rpsTicket.startsWith("d=")) {
            // username+password login doesn't seem to need this prefix, code auth does
            rpsTicket = `d=${ rpsTicket }`;
        }
        // https://user.auth.xboxlive.com/user/authenticate
        const userTokenResponse: ExchangeRpsTicketResponse = await XboxLiveAuth.exchangeRpsTicketForUserToken(rpsTicket);
        // console.log("exchangeRpsTicket")
        // console.log(JSON.stringify(userTokenResponse))
        return {
            token: userTokenResponse,
            mc: await this.getIdentityForRelyingParty(userTokenResponse, MC_XSTSRelyingParty),
            xbox: await this.getIdentityForRelyingParty(userTokenResponse, XBOX_XSTSRelyingParty)
        };
    }

    static async getIdentityForRelyingParty(userTokenResponse: ExchangeRpsTicketResponse, relyingParty: string): Promise<XSTSResponse> {
        // https://xsts.auth.xboxlive.com/xsts/authorize
        const body = {
            RelyingParty: relyingParty,
            TokenType: "JWT",
            Properties: {
                SandboxId: "RETAIL",
                UserTokens: [userTokenResponse.Token]
            }
        };
        const authResponse = await Requests.genericRequest({
            method: "POST",
            url: "https://xsts.auth.xboxlive.com/xsts/authorize",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                /*"x-xbl-contract-version": 1*/
            },
            data: body
        });
        return authResponse.data as XSTSResponse
    }

    static async getMinecraftIdentity(userTokenResponse: ExchangeRpsTicketResponse): Promise<AuthenticateResponse> {
        // https://xsts.auth.xboxlive.com/xsts/authorize
        const identityResponse = await XboxLiveAuth.exchangeUserTokenForXSTSIdentity(userTokenResponse.Token, {
            XSTSRelyingParty: MC_XSTSRelyingParty,
            raw: false
        }) as AuthenticateResponse;
        // console.log("MC exchangeUserToken")
        // console.log(JSON.stringify(identityResponse))
        return identityResponse;
    }

    static async getXboxIdentity(userTokenResponse: ExchangeRpsTicketResponse): Promise<AuthenticateResponse> {
        // https://xsts.auth.xboxlive.com/xsts/authorize
        const identityResponse = await XboxLiveAuth.exchangeUserTokenForXSTSIdentity(userTokenResponse.Token, {
            XSTSRelyingParty: XBOX_XSTSRelyingParty,
            raw: false
        }) as AuthenticateResponse;
        // console.log("XBOX exchangeUserToken")
        // console.log(JSON.stringify(identityResponse))
        return identityResponse;
    }

    static async loginToMinecraftWithXbox(userHash: string, xstsToken: string): Promise<XboxLoginResponse> {
        const body = {
            identityToken: `XBL3.0 x=${ userHash };${ xstsToken }`
        };
        const xboxLoginResponse = await Requests.minecraftServicesRequest({
            method: "POST",
            url: "/authentication/login_with_xbox",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            data: body
        });
        const xboxLoginBody = xboxLoginResponse.data;
        // console.log("xboxLogin")
        // console.log(JSON.stringify(xboxLoginBody));
        return xboxLoginBody as XboxLoginResponse;
    }

    static async checkGameOwnership(accessToken: string): Promise<boolean> {
        const entitlementsResponse = await Requests.minecraftServicesRequest({
            method: "GET",
            url: "/entitlements/mcstore",
            headers: {
                Authorization: `Bearer ${ accessToken }`
            }
        });
        const entitlementsBody = entitlementsResponse.data;
        // console.log("entitlements");
        // console.log(entitlementsBody)
        return entitlementsBody.hasOwnProperty("items") && entitlementsBody["items"].length > 0;
    }


    static async refreshXboxAccessToken(xboxRefreshToken: string, useCustomClient: boolean, xboxInfoConsumer?: (info: XboxInfo) => void): Promise<string> {
        const config = await getConfig();
        let form: any;
        if (useCustomClient) {
            form = {
                "client_id": config.microsoft.clientId,
                "client_secret": config.microsoft.clientSecret,
                "refresh_token": xboxRefreshToken,
                "grant_type": "refresh_token",
                "redirect_uri": `https://${ config.server }.api.mineskin.org/accountManager/microsoft/oauth/callback`
            }
        } else {
            form = {
                "client_id": /*"00000000402b5328"*/"000000004C12AE6F",
                "refresh_token": xboxRefreshToken,
                "grant_type": "refresh_token",
                "redirect_uri": "https://login.live.com/oauth20_desktop.srf",
                "scope": "service::user.auth.xboxlive.com::MBI_SSL"
            }
        }
        return await Microsoft.authenticateXboxWithFormData(form, xboxInfoConsumer);
    }

    static async authenticateXboxWithFormData(form: any, xboxInfoConsumer?: (info: XboxInfo) => void): Promise<string> {
        const refreshResponse = await Requests.liveLoginRequest({
            method: "POST",
            url: "/oauth20_token.srf",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json"
            },
            data: qs.stringify(form)
        });
        const refreshBody = refreshResponse.data;
        // console.log("refreshBody");
        // console.log(JSON.stringify(refreshBody))

        // Microsoft/Xbox accessToken
        const xboxAccessToken = refreshBody["access_token"];
        const xboxRefreshToken = refreshBody["refresh_token"];

        const identityResponses = await Microsoft.exchangeRpsTicketForIdentities(xboxAccessToken);
        console.log("identities");
        // console.log(identityResponses)
        const mcIdentity = identityResponses.mc;
        const xboxIdentity = identityResponses.xbox;

        const userHash = mcIdentity.DisplayClaims.xui[0].uhs;
        const XSTSToken = mcIdentity.Token;

        const xboxLoginResponse = await Microsoft.loginToMinecraftWithXbox(userHash, XSTSToken);
        const minecraftXboxUsername = xboxLoginResponse.username;

        if (xboxInfoConsumer) {
            try {
                xboxInfoConsumer({
                    accessToken: xboxAccessToken,
                    refreshToken: xboxRefreshToken,
                    username: minecraftXboxUsername,
                    userId: refreshBody["user_id"],
                    userHash: userHash,
                    XSTSToken: XSTSToken,

                    msa: {
                        auth: {
                            accessToken: xboxAccessToken,
                            refreshToken: xboxRefreshToken,
                            expires: epochSeconds() + parseInt(refreshBody["expires_in"]),
                            issued: epochSeconds(),
                            userId: refreshBody["user_id"]
                        },
                        userToken: {
                            token: identityResponses.token.Token,
                            expires: toEpochSeconds(Date.parse(identityResponses.token.NotAfter)),
                            issued: toEpochSeconds(Date.parse(identityResponses.token.IssueInstant)),
                            userHash: identityResponses.token.DisplayClaims.xui[0].uhs
                        },
                        identities: {
                            mc: {
                                token: mcIdentity.Token,
                                expires: toEpochSeconds(Date.parse(mcIdentity.NotAfter)),
                                issued: toEpochSeconds(Date.parse(mcIdentity.IssueInstant)),
                                claims: mcIdentity.DisplayClaims.xui[0]
                            },
                            xbox: {
                                token: xboxIdentity.Token,
                                expires: toEpochSeconds(Date.parse(xboxIdentity.NotAfter)),
                                issued: toEpochSeconds(Date.parse(xboxIdentity.IssueInstant)),
                                claims: xboxIdentity.DisplayClaims.xui[0]
                            }
                        }
                    }

                });
            } catch (e) {
                console.warn(e);
                Sentry.captureException(e);
            }
        }
        // Minecraft accessToken - does not return a refresh token, so need the MS one above
        return xboxLoginResponse.access_token;
    }

}


export class Authentication {

    public static async authenticate(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        return await Sentry.startSpan({
            op: "auth_authenticate",
            name: "authenticate",
        }, async span => {
            const metrics = await MineSkinMetrics.get();
            const metric = metrics.authentication
                .tag("server", metrics.config.server)
                .tag("type", account.accountType || AccountType.MICROSOFT)
                .tag("account", account.id)
                .tag("genEnv", "api");
            try {
                let prevAccessTokenExpiration = account.accessTokenExpiration;
                let result: IAccountDocument;
                if (account.accountType === AccountType.MICROSOFT) {
                    result = await Microsoft.authenticate(account, bread);
                } else {
                    result = await Mojang.authenticate(account, bread)
                        .then(account => Mojang.completeChallenges(account, bread));
                }
                metric
                    .tag("result", "success")
                    .tag("source", (prevAccessTokenExpiration === result.accessTokenExpiration) ? "reused" : result.accessTokenSource)
                    .inc();
                return result;
            } catch (e) {
                metric.tag("result", "fail");
                if (e instanceof AuthenticationError) {
                    console.warn(e);
                    if (e.code === AuthError.MISSING_CREDENTIALS) {
                        Notifications.notifyMissingCredentials(account);
                    }
                    if (e.code === AuthError.MICROSOFT_AUTH_FAILED || e.code === AuthError.MOJANG_AUTH_FAILED) {
                        Notifications.notifyLoginFailed(account, e);
                    }
                    // if (e.details && e.details.response) {
                    //     if (e.details.response.status >= 400 && e.details.response.status <= 403) {
                    //         if (account.passwordNew) {
                    //             console.warn(warn(`${ bread?.breadcrumb } [Auth] Resetting access token for ${ account.toSimplifiedString() }`));
                    //             account.accessToken = "";
                    //         }
                    //     }
                    // }
                    metric.tag("reason", e.code);
                } else {
                    metric.tag("reason", e.name);
                }
                metric.inc();
                span?.setStatus({
                    code: 2,
                    message: "internal_error"
                });
                throw e;
            }
        })


    }

    public static async getExistingAccountServer(email: string): Promise<Maybe<string>> {
        return Account.findOne({email: email}, "_id email requestServer").then(account => {
            if (!account) {
                return undefined;
            }
            return account.requestServer || undefined;
        })
    }

}

export enum AuthError {
    UNSUPPORTED_ACCOUNT = "unsupported_account",
    MISSING_CREDENTIALS = "missing_credentials",

    MOJANG_AUTH_FAILED = "mojang_auth_failed",
    MOJANG_REFRESH_FAILED = "mojang_refresh_failed",
    MOJANG_CHALLENGES_FAILED = "mojang_challenges_failed",

    MICROSOFT_AUTH_FAILED = "microsoft_auth_failed",
    MICROSOFT_REFRESH_FAILED = "microsoft_refresh_failed",

    DOES_NOT_OWN_MINECRAFT = "does_not_own_minecraft"
}

export class AuthenticationError extends MineSkinError {
    constructor(code: AuthError, msg: string, public meta?: {
        httpCode?: number;
        source?: ErrorSource;
        account?: IAccountDocument;
        error?: Error;
        details?: any;
    }) {
        super(code, msg);
        Object.setPrototypeOf(this, AuthenticationError.prototype);
    }

    get name(): string {
        return 'AuthenticationError';
    }
}

// Microsoft

export interface XboxInfo {
    /**@deprecated**/
    accessToken?: string;
    /**@deprecated**/
    refreshToken?: string;
    /**@deprecated**/
    XSTSToken?: string;
    /**@deprecated**/
    userId?: string;
    /**@deprecated**/
    userHash?: string;
    /**@deprecated**/
    username?: string;

    msa?: MicrosoftAuthInfo;
}

interface XboxLoginResponse {
    username: string;
    access_token: string;
    expires_in: number;
}

// Mojang

interface MojangLoginResponse {
    accessToken: string;
    clientToken: string;
    selectedProfile?: MojangProfile;
    user?: MojangUser;
}

interface MojangProfile {
    id: string;
    name: string;
    userId: string;
    createdAt: number;
    legacyProfile: boolean;
    suspended: boolean;
    paid: boolean;
    migrated: boolean;
    legacy: boolean;
}

interface MojangUser {
    id: string;
    email: string;
    username: string;
}

export interface BasicMojangProfile {
    id: string;
    name: string;
    skins?: MojangProfileSkin[];
    capes?: MojangProfileCape[];
}

export interface MojangProfileSkin {
    id: string;
    state: "ACTIVE" | string;
    url: string;
    variant: string;
}

export interface MojangProfileCape {
    id: string;
    state: "ACTIVE" | string;
    url: string;
    alias: string;
}

interface MojangChallengesResponse {
    needSolving: boolean;
    questions?: MojangSecurityQuestion[];
}

export interface MojangSecurityQuestion {
    answer: { id: number };
    question: { id: number, question: string };
}

export interface MojangSecurityAnswer {
    id: number;
    answer: string;
}

interface XSTSResponse {
    IssueInstant: string;
    NotAfter: string;
    Token: string;
    DisplayClaims: {
        xui: [
            {
                uhs: string;
                [claim: string]: any;
            }
        ]
    }
}

interface MicrosoftIdentities {
    xbox: XSTSResponse;
    mc: XSTSResponse;
}
