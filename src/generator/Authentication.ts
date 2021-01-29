import { Requests } from "./Requests";
import * as Sentry from "@sentry/node";
import * as XboxLiveAuth from "@xboxreplay/xboxlive-auth";
import { AuthenticateResponse } from "@xboxreplay/xboxlive-auth";
import * as qs from "querystring";
import { Discord } from "../util/Discord";
import { AxiosResponse } from "axios";
import { getConfig } from "../typings/Configs";
import { IAccountDocument, MineSkinError } from "../typings";
import { AccessTokenSource, AccountType } from "../typings/IAccountDocument";
import { debug, warn } from "../util/colors";
import { Encryption } from "../util/Encryption";
import { AUTHENTICATION_METRIC } from "../util/metrics";
import { Bread } from "../typings/Bread";

const config = getConfig();

const ACCESS_TOKEN_EXPIRATION_MOJANG = 86360;
const ACCESS_TOKEN_EXPIRATION_MICROSOFT = 86360;

const ACCESS_TOKEN_EXPIRATION_THRESHOLD = 1800;

const XSTSRelyingParty = 'rp://api.minecraftservices.com/'

export class Mojang {

    public static async authenticate(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        if (account.microsoftAccount && account.accountType !== AccountType.MOJANG) {
            throw new AuthenticationError(AuthError.UNSUPPORTED_ACCOUNT, "Can't authenticate microsoft account via mojang auth", account);
        }

        if (!account.accessToken) { // Needs login
            console.log(warn(bread?.breadcrumb + " [Auth] Account #" + account.id + " doesn't have access token"));
            return await Mojang.login(account);
        }

        // Check token expiration
        if (account.accessTokenExpiration && account.accessTokenExpiration - Math.round(Date.now() / 1000) < ACCESS_TOKEN_EXPIRATION_THRESHOLD) {
            console.log(debug(bread?.breadcrumb + " [Auth] (#" + account.id + ") Force-refreshing accessToken, since it will expire in less than 30 minutes"));
            return await Mojang.refreshAccessTokenOrLogin(account);
        }

        // Validate token which shouldn't be expired yet
        if (await Mojang.validateAccessToken(account)) {
            // Still valid!
            return account;
        }

        // Fallback to refresh / login
        return await Mojang.refreshAccessTokenOrLogin(account);
    }

    /// LOGIN

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

    static async login(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        if (account.microsoftAccount && account.accountType !== AccountType.MOJANG) {
            throw new AuthenticationError(AuthError.UNSUPPORTED_ACCOUNT, "Can't login microsoft account via mojang auth", account);
        }

        if (!account.passwordNew) {
            throw new AuthenticationError(AuthError.MISSING_CREDENTIALS, "Account has no password", account);
        }

        console.log(debug(bread?.breadcrumb + " [Auth] Logging in " + account.toSimplifiedString()));
        const authBody = await Mojang.loginWithCredentials(account.getEmail(), Encryption.decrypt(account.passwordNew), account.getOrCreateClientToken()).catch(err => {
            if (err.response) {
                throw new AuthenticationError(AuthError.MOJANG_AUTH_FAILED, "Failed to authenticate via mojang", account, err);
            }
            throw err;
        })
        if (authBody.selectedProfile) {
            account.playername = authBody.selectedProfile.name
        }

        console.log(debug(bread?.breadcrumb + " [Auth] Got new access token for " + account.toSimplifiedString()));
        account.accessToken = authBody.accessToken;
        account.accessTokenExpiration = Math.round(Date.now() / 1000) + ACCESS_TOKEN_EXPIRATION_MOJANG;
        account.accessTokenSource = AccessTokenSource.LOGIN_MOJANG;
        account.updateRequestServer(config.server);
        console.log(debug(bread?.breadcrumb + " [Auth] (#" + account.id + ") Request server set to " + account.requestServer));

        return await account.save();
    }

    /// TOKENS

    static async validateAccessToken(account: IAccountDocument): Promise<boolean> {
        if (account.microsoftAccount && account.accountType !== AccountType.MOJANG) {
            throw new AuthenticationError(AuthError.UNSUPPORTED_ACCOUNT, "Can't validate microsoft account access token via mojang auth", account);
        }

        const body = {
            accessToken: account.accessToken,
            clientToken: account.getOrCreateClientToken(),
            requestUser: true
        };
        try {
            const validateResponse = await Requests.mojangAuthRequest({
                method: "POST",
                url: "/validate",
                data: JSON.stringify(body)
            });
            return Requests.isOk(validateResponse);
        } catch (e) {
            return false;
        }
    }

    static async refreshAccessTokenOrLogin(account: IAccountDocument): Promise<IAccountDocument> {
        try {
            return await Mojang.refreshAccessToken(account);
        } catch (e) {
            if (e instanceof AuthenticationError) {
                if (e.code === AuthError.MOJANG_REFRESH_FAILED) {
                    // Couldn't refresh, attempt to login
                    return await Mojang.login(account);
                }
            }
            throw e;
        }
    }

    static async refreshAccessToken(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        if (account.microsoftAccount && account.accountType !== AccountType.MOJANG) {
            throw new AuthenticationError(AuthError.UNSUPPORTED_ACCOUNT, "Can't refresh microsoft account access token via mojang auth", account);
        }

        console.log(debug(bread?.breadcrumb + " [Auth] Refreshing " + account.toSimplifiedString()));
        const body = {
            accessToken: account.accessToken,
            clientToken: account.getOrCreateClientToken(),
            requestUser: true
        };
        const refreshResponse = await Requests.mojangAuthRequest({
            method: "POST",
            url: "/refresh",
            data: JSON.stringify(body)
        }).catch(err => {
            if (err.response) {
                throw new AuthenticationError(AuthError.MOJANG_REFRESH_FAILED, "Failed to refresh token via mojang", account, err);
            }
            throw err;
        })
        const refreshBody = refreshResponse.data;
        if (refreshBody.hasOwnProperty("selectedProfile")) {
            account.playername = refreshBody["selectedProfile"]["name"];
        }

        console.log(debug(bread?.breadcrumb + " [Auth] Refreshed access token for " + account.toSimplifiedString()));
        account.accessToken = refreshBody["accessToken"];
        account.accessTokenExpiration = Math.round(Date.now() / 1000) + ACCESS_TOKEN_EXPIRATION_MOJANG;
        account.accessTokenSource = AccessTokenSource.REFRESH_MOJANG;
        account.updateRequestServer(config.server);
        console.log(debug(bread?.breadcrumb + " [Auth] (#" + account.id + ") Request server set to " + account.requestServer));

        return await account.save();
    }

    /// CHALLENGES

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

    static async completeChallenges(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        if (account.microsoftAccount && account.accountType !== AccountType.MOJANG) {
            throw new AuthenticationError(AuthError.UNSUPPORTED_ACCOUNT, "Can't complete challenges for microsoft account", account);
        }

        if ((!account.multiSecurity || account.multiSecurity.length < 3) && (!account.security || account.security.length === 0)) {
            console.log(debug(bread?.breadcrumb + " [Auth] (#" + account.id + ") Skipping security questions as there are no answers configured"));
            return account;
        }

        const challenges = await Mojang.getChallenges(account.accessToken)
            .catch(err => {
                if (err.response) {
                    throw new AuthenticationError(AuthError.MOJANG_CHALLENGES_FAILED, "Failed to complete security challenges", account, err);
                }
                throw err;
            })
        if (!challenges.needSolving || !challenges.questions) {
            return account;
        }

        const questions = challenges.questions;
        const answers: MojangSecurityAnswer[] = [];

        if (account.multiSecurity && account.multiSecurity.length > 0) {
            const answersById: { [s: string]: string } = {};
            account.multiSecurity.forEach(answer => {
                answersById[answer.id] = answer.answer;
            });
            questions.forEach(question => {
                if (!answersById.hasOwnProperty(question.answer.id)) {
                    console.warn(bread?.breadcrumb + " Missing security answer for question " + question.question.id + "(" + question.question.question + "), Answer #" + question.answer.id);
                }
                answers.push({ id: question.answer.id, answer: (answersById[question.answer.id] || account.security)! });
            });
        } else {
            questions.forEach(question => {
                answers.push({ id: question.answer.id, answer: account.security! });
            });
        }

        const answerPostResponse = await Mojang.submitChallengeAnswers(account.accessToken, answers)
            .catch(err => {
                if (err.response) {
                    throw new AuthenticationError(AuthError.MOJANG_CHALLENGES_FAILED, "Failed to complete security challenges", account, err);
                }
                throw err;
            })
        return account;
    }


}

export class Microsoft {

    public static async authenticate(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        if (!account.microsoftAccount && account.accountType !== AccountType.MICROSOFT) {
            throw new AuthenticationError(AuthError.UNSUPPORTED_ACCOUNT, "Can't authenticate non-microsoft account via microsoft auth", account);
        }

        if (!account.accessToken) { // Needs login
            return await Microsoft.login(account);
        }

        // Check token expiration
        if (account.accessTokenExpiration && account.accessTokenExpiration - Math.round(Date.now() / 1000) < ACCESS_TOKEN_EXPIRATION_THRESHOLD) {
            console.log(debug(bread?.breadcrumb + " [Auth] (#" + account.id + ") Force-refreshing accessToken, since it will expire in less than 30 minutes"));
            return await Microsoft.refreshAccessTokenOrLogin(account);
        }

        try {
            // Try to use the access token
            if (await Microsoft.checkGameOwnership(account.accessToken)) {
                // Still valid!
                return account;
            }
        } catch (e) {
            Sentry.captureException(e);
        }

        // Fallback to refresh / login
        return await Microsoft.refreshAccessTokenOrLogin(account);
    }

    static async login(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        if (!account.microsoftAccount && account.accountType !== AccountType.MICROSOFT) {
            throw new AuthenticationError(AuthError.UNSUPPORTED_ACCOUNT, "Can't login non-microsoft account via microsoft auth", account);
        }

        if (!account.passwordNew) {
            throw new AuthenticationError(AuthError.MISSING_CREDENTIALS, "Account has no password", account);
        }


        console.log(debug(bread?.breadcrumb + " [Auth] Logging in " + account.toSimplifiedString()));
        const minecraftAccessToken = await Microsoft.loginWithEmailAndPassword(account.getEmail(), Encryption.decrypt(account.passwordNew), xboxInfo => {
            account.microsoftAccessToken = xboxInfo.accessToken;
            account.microsoftRefreshToken = xboxInfo.refreshToken;
            account.microsoftUserId = xboxInfo.userId;
            account.minecraftXboxUsername = xboxInfo.username;
        }).catch(err => {
            if (err.response) {
                throw new AuthenticationError(AuthError.MICROSOFT_AUTH_FAILED, "Failed to login", account, err);
            }
            throw err;
        })
        const ownsMinecraft = await Microsoft.checkGameOwnership(minecraftAccessToken);
        if (!ownsMinecraft) {
            throw new AuthenticationError(AuthError.DOES_NOT_OWN_MINECRAFT, "User does not own minecraft", account);
        }

        console.log(debug(bread?.breadcrumb + " [Auth] Got new access token for " + account.toSimplifiedString()));
        account.accessToken = minecraftAccessToken;
        account.accessTokenExpiration = Math.round(Date.now() / 1000) + ACCESS_TOKEN_EXPIRATION_MICROSOFT;
        account.accessTokenSource = AccessTokenSource.LOGIN_MICROSOFT;
        account.updateRequestServer(config.server);
        console.log(debug(bread?.breadcrumb + " [Auth] (#" + account.id + ") Request server set to " + account.requestServer));

        return await account.save();
    }

    static async refreshAccessTokenOrLogin(account: IAccountDocument): Promise<IAccountDocument> {
        try {
            return await Microsoft.refreshAccessToken(account);
        } catch (e) {
            if (e instanceof AuthenticationError) {
                if (e.code === AuthError.MICROSOFT_REFRESH_FAILED) {
                    // Couldn't refresh, attempt to login
                    return await Microsoft.login(account);
                }
            }
            throw e;
        }
    }

    static async refreshAccessToken(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        if (!account.microsoftAccount && account.accountType !== AccountType.MICROSOFT) {
            throw new AuthenticationError(AuthError.UNSUPPORTED_ACCOUNT, "Can't refresh token of non-microsoft account via microsoft auth", account);
        }
        if (!account.microsoftRefreshToken) {
            throw new AuthenticationError(AuthError.MICROSOFT_REFRESH_FAILED, "Account has no refresh token", account);
        }

        const newMinecraftAccessToken = await Microsoft.refreshXboxAccessToken(account.microsoftRefreshToken, xboxInfo => {
            account.microsoftAccessToken = xboxInfo.accessToken;
            account.microsoftRefreshToken = xboxInfo.refreshToken;
            account.minecraftXboxUsername = xboxInfo.username;
        });
        console.log(debug(bread?.breadcrumb + " [Auth] Refreshed access token for " + account.toSimplifiedString()));
        account.accessToken = newMinecraftAccessToken;
        account.accessTokenExpiration = Math.round(Date.now() / 1000) + ACCESS_TOKEN_EXPIRATION_MICROSOFT;
        account.accessTokenSource = AccessTokenSource.REFRESH_MICROSOFT;
        account.updateRequestServer(config.server);
        console.log(debug(bread?.breadcrumb + " [Auth] (#" + account.id + ") Request server set to " + account.requestServer));

        return await account.save();
    }

    // based on https://github.com/PrismarineJS/node-minecraft-protocol/blob/master/src/client/microsoftAuth.js
    static async loginWithEmailAndPassword(email: string, password: string, xboxInfoConsumer?: (info: XboxInfo) => void): Promise<string> {
        // https://login.live.com/oauth20_authorize.srf
        const preAuthResponse = await XboxLiveAuth.preAuth();
        console.log("preAuth")
        console.log(JSON.stringify(preAuthResponse))
        const loginResponse = await XboxLiveAuth.logUser(preAuthResponse, { email, password });
        console.log("logUser")
        console.log(JSON.stringify(loginResponse));

        const xboxUserId = loginResponse.user_id;
        const xboxAccessToken = loginResponse.access_token;
        const xboxRefreshToken = loginResponse.refresh_token;

        const identityResponse = await Microsoft.exchangeRpsTicketForIdentity(xboxAccessToken);

        const userHash = identityResponse.userHash;

        const xboxLoginResponse = await Microsoft.loginToMinecraftWithXbox(identityResponse.userHash, identityResponse.XSTSToken);
        const minecraftXboxUsername = xboxLoginResponse.username;

        if (xboxInfoConsumer) {
            try {
                xboxInfoConsumer({
                    accessToken: xboxAccessToken,
                    refreshToken: xboxRefreshToken,
                    userId: xboxUserId,
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

    static async exchangeRpsTicketForIdentity(rpsTicket: string): Promise<AuthenticateResponse> {
        // https://user.auth.xboxlive.com/user/authenticate
        const userTokenResponse = await XboxLiveAuth.exchangeRpsTicketForUserToken(rpsTicket);
        console.log("exchangeRpsTicket")
        console.log(JSON.stringify(userTokenResponse))
        // https://xsts.auth.xboxlive.com/xsts/authorize
        const identityResponse = await XboxLiveAuth.exchangeUserTokenForXSTSIdentity(userTokenResponse.Token, { XSTSRelyingParty, raw: false }) as AuthenticateResponse;
        console.log("exchangeUserToken")
        console.log(JSON.stringify(identityResponse))
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
        console.log("xboxLogin")
        console.log(JSON.stringify(xboxLoginBody));
        return xboxLoginBody as XboxLoginResponse;
    }

    static async checkGameOwnership(accessToken: string): Promise<boolean> {
        console.log("checkGameOwnership")
        const entitlementsResponse = await Requests.minecraftServicesRequest({
            method: "POST",
            url: "/entitlements/mcstore",
            headers: {
                Authorization: `Bearer ${ accessToken }`
            }
        });
        const entitlementsBody = entitlementsResponse.data;
        console.log(JSON.stringify(entitlementsBody));
        return entitlementsBody.hasOwnProperty("items") && entitlementsBody["items"].length > 0;
    }

    static async loginWithXboxCode(code: string, xboxInfoConsumer?: (info: XboxInfo) => void): Promise<string> {
        const form = {
            "client_id": /*"00000000402b5328"*/"000000004C12AE6F",
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": "https://login.live.com/oauth20_desktop.srf",
            "scope": "service::user.auth.xboxlive.com::MBI_SSL"
        }
        return Microsoft.authenticateXboxWithFormData(form, xboxInfoConsumer);
    }

    static async refreshXboxAccessToken(xboxRefreshToken: string, xboxInfoConsumer?: (info: XboxInfo) => void): Promise<string> {
        const form = {
            "client_id": /*"00000000402b5328"*/"000000004C12AE6F",
            "refresh_token": xboxRefreshToken,
            "grant_type": "refresh_token",
            "redirect_uri": "https://login.live.com/oauth20_desktop.srf",
            "scope": "service::user.auth.xboxlive.com::MBI_SSL"
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
        console.log("refreshBody");
        console.log(JSON.stringify(refreshBody))

        // Microsoft/Xbox accessToken
        const xboxAccessToken = refreshBody["access_token"];
        const xboxRefreshToken = refreshBody["refresh_token"];

        const identityResponse = await Microsoft.exchangeRpsTicketForIdentity(xboxAccessToken);

        const xboxLoginResponse = await Microsoft.loginToMinecraftWithXbox(identityResponse.userHash, identityResponse.XSTSToken);
        const minecraftXboxUsername = xboxLoginResponse.username;

        if (xboxInfoConsumer) {
            try {
                xboxInfoConsumer({
                    accessToken: xboxAccessToken,
                    refreshToken: xboxRefreshToken,
                    username: minecraftXboxUsername
                });
            } catch (e) {
                console.warn(e);
                Sentry.captureException(e);
            }
        }
        // Minecraft accessToken
        return xboxLoginResponse.access_token;
    }

}


export class Authentication {

    public static async authenticate(account: IAccountDocument, bread?: Bread): Promise<IAccountDocument> {
        const metric = AUTHENTICATION_METRIC
            .tag("server", config.server)
            .tag("type", account.getAccountType())
            .tag("account", account.id);
        try {
            let result: IAccountDocument;
            if (account.getAccountType() === AccountType.MICROSOFT || account.microsoftAccount) {
                result = await Microsoft.authenticate(account, bread);
            } else {
                result = await Mojang.authenticate(account, bread)
                    .then(account => Mojang.completeChallenges(account, bread));
            }
            metric
                .tag("result", "success")
                .tag("source", result.accessTokenSource)
                .inc();
            return result;
        } catch (e) {
            if (e instanceof AuthenticationError) {
                if (e.code === AuthError.MISSING_CREDENTIALS) {
                    Discord.notifyMissingCredentials(account);
                }
                metric
                    .tag("result", "fail")
                    .tag("reason", e.code)
                    .inc();
            }
            throw e;
        }
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
    constructor(code: AuthError, msg: string, public account?: IAccountDocument, public details?: any) {
        super(code, msg);
        Object.setPrototypeOf(this, AuthenticationError.prototype);
    }

    get name(): string {
        return 'AuthenticationError';
    }
}

// Microsoft

export interface XboxInfo {
    accessToken?: string;
    refreshToken?: string;
    userId?: string;
    userHash?: string;
    username?: string;
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
}

export interface MojangProfileSkin {
    id: string;
    state: string;
    url: string;
    variant: string;
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
