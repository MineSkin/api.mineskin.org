import { Application, NextFunction, Request, Response } from "express";
import { AuthenticationError, AuthError, BasicMojangProfile, Microsoft, Mojang, MojangSecurityAnswer, XboxInfo } from "../generator/Authentication";
import { base64decode, corsWithCredentialsMiddleware, getIp, Maybe, md5, sha256, sha512, stripUuid } from "../util";
import * as session from "express-session";
import { Generator } from "../generator/Generator";
import { Account } from "../database/schemas";
import { Caching } from "../generator/Caching";
import { Requests } from "../generator/Requests";
import * as qs from "querystring";
import { Discord } from "../util/Discord";
import { getConfig } from "../typings/Configs";
import { AccessTokenSource, AccountType, IAccountDocument } from "../typings/IAccountDocument";
import { MineSkinError, MineSkinRequest } from "../typings";
import { Encryption } from "../util/Encryption";
import { debug, info, warn } from "../util/colors";
import * as Sentry from "@sentry/node";
import { Time } from "@inventivetalent/loading-cache";

const config = getConfig();

export const register = (app: Application) => {

    app.use("/accountManager", corsWithCredentialsMiddleware);
    app.use("/accountManager", session({
        secret: config.sessionSecret,
        cookie: {
            maxAge: Time.minutes(10),
            domain: "api.mineskin.org"
        }
    }))

    /// MOJANG

    app.post("/accountManager/mojang/login", async (req: AccountManagerRequest, res: Response) => {
        await regenerateSession(req);
        if (!req.body["email"] || !req.body["password"]) {
            res.status(400).json({ error: "missing login data" });
            return;
        }
        const ip = getIp(req);

        const loginResponse = await Mojang.loginWithCredentials(req.body["email"], base64decode(req.body["password"]), md5(req.body["email"] + "_" + ip)).catch(err => {
            if (err.response) {
                throw new AuthenticationError(AuthError.MOJANG_AUTH_FAILED, "Failed to authenticate via mojang", undefined, err);
            }
            throw err;
        })
        if (loginResponse.selectedProfile!.legacy) {
            res.status(400).json({ error: "cannot add legacy profile" });
            return;
        }
        if (loginResponse.selectedProfile!.suspended) {
            res.status(400).json({ error: "cannot add suspended profile" });
            return;
        }
        req.session.account = {
            type: AccountType.MOJANG,
            email: req.body["email"],
            passwordHash: sha512(req.body["password"]),
            token: loginResponse.accessToken
        };
        res.json({
            success: !!loginResponse.accessToken,
            token: loginResponse.accessToken,
            profile: loginResponse.selectedProfile
        });
    });

    app.post("/accountManager/mojang/getChallenges", async (req: AccountManagerRequest, res: Response) => {
        if (!validateSessionAndToken(req, res)) return;

        const challengeResponse = await Mojang.getChallenges(req.session.account!.token!).catch(err => {
            if (err.response) {
                throw new AuthenticationError(AuthError.MOJANG_CHALLENGES_FAILED, "Failed to get security challenges", undefined, err);
            }
            throw err;
        });
        res.json({
            success: true,
            needToSolveChallenges: challengeResponse.needSolving && challengeResponse.questions,
            questions: challengeResponse.questions
        });
    });

    app.post("/accountManager/mojang/solveChallenges", async (req: AccountManagerRequest, res: Response) => {
        if (!validateSessionAndToken(req, res)) return;

        if (!req.body["securityAnswers"]) {
            res.status(400).json({ error: "missing answers" });
            return;
        }
        if (!validateMultiSecurityAnswers(req.body["securityAnswers"], req, res)) return;
        const answers = req.body["securityAnswers"] as MojangSecurityAnswer[];

        const solveResponse = await Mojang.submitChallengeAnswers(req.session.account!.token!, answers).catch(err => {
            if (err.response) {
                throw new AuthenticationError(AuthError.MOJANG_CHALLENGES_FAILED, "Failed to complete security challenges", undefined, err);
            }
            throw err;
        })
        res.json({
            success: true,
            msg: "Challenges solved"
        });
    })


    /// MICROSOFT

    app.post("/accountManager/microsoft/login", async (req: AccountManagerRequest, res: Response) => {
        await regenerateSession(req);
        if (!req.body["email"] || !req.body["password"]) {
            res.status(400).json({ error: "missing login data" });
            return;
        }

        let microsoftInfo = undefined;
        const minecraftAccessToken = await Microsoft.loginWithEmailAndPassword(req.body["email"], base64decode(req.body["password"]), xboxInfo => {
            microsoftInfo = xboxInfo;
        }).catch(err => {
            if (err.response) {
                throw new AuthenticationError(AuthError.MICROSOFT_AUTH_FAILED, "Failed to login", undefined, err);
            }
            throw err;
        });
        req.session.account = {
            type: AccountType.MICROSOFT,
            email: req.body["email"],
            passwordHash: sha512(req.body["password"]),
            token: minecraftAccessToken,
            microsoftInfo: microsoftInfo
        };

        const ownsMinecraft = await Microsoft.checkGameOwnership(minecraftAccessToken)
            .catch(err => {
                if (err.response) {
                    throw new AuthenticationError(AuthError.DOES_NOT_OWN_MINECRAFT, "Failed to check game ownership", undefined, err);
                }
                throw err;
            })
        if (!ownsMinecraft) {
            throw new AuthenticationError(AuthError.DOES_NOT_OWN_MINECRAFT, "User does not own minecraft", undefined);
        }

        res.json({
            success: !!minecraftAccessToken,
            token: minecraftAccessToken
        });
    })


    /// INDEPENDENT

    app.post("/accountManager/logout", async (req: AccountManagerRequest, res: Response) => {
        req.session.destroy(() => res.status(200).end());
    })

    app.get("/accountManager/preferredAccountServer", (req: Request, res: Response) => {
        Generator.getPreferredAccountServer().then(server => {
            res.json({
                server: server,
                host: `${ server }.api.mineskin.org`
            });
        }).catch(err => {
            Sentry.captureException(err);
            res.status(404).json({ error: "failed to get server" });
        })
    })

    // Stuff that requires being logged in

    app.post("/accountManager/userProfile", async (req: AccountManagerRequest, res: Response) => {
        if (!validateSessionAndToken(req, res)) return;

        const profile = await getMojangProfile(req.session.account!.token!);
        if (!profile) {
            res.status(400).json({ error: "invalid session" });
            return;
        }
        if (req.session && req.session.account) {
            req.session.account.uuid = profile.id;
        }
        res.json(profile);
    });

    app.post("/accountManager/myAccount", async (req: AccountManagerRequest, res: Response) => {
        if (!validateSessionAndToken(req, res)) return;
        if (!req.body["email"]) {
            res.status(400).json({ error: "missing credentials" });
            return;
        }
        if (!req.session || !req.session.account) {
            res.status(400).json({ error: "invalid session" });
            return;
        }

        const profileValidation = await getAndValidateMojangProfile(req.session.account!.token!, req.body["uuid"]);
        if (!profileValidation.valid || !profileValidation.profile) return;

        const account = await Account.findOne({
            type: "external",
            uuid: profileValidation.profile.id,
            accountType: req.session.account.type,
            $or: [
                { email: req.session.account.email },
                { username: req.session.account.email }
            ]
        }).exec();
        if (!account) {
            res.status(404).json({ error: "account not found" });
            return;
        }
        if (account.uuid !== req.body["uuid"]) {
            //wth
            return;
        }

        // Update password
        if (req.body["password"] && req.body["password"].length > 3) {
            account.passwordNew = Encryption.encrypt(base64decode(req.body["password"]));
        }

        // Update token
        if (req.session.account.token) {
            account.accessToken = req.session.account.token;
            account.accessTokenSource = req.session.account.type === AccountType.MICROSOFT ? AccessTokenSource.USER_LOGIN_MICROSOFT : AccessTokenSource.USER_LOGIN_MOJANG;
            account.accessTokenExpiration = Math.round(Date.now() / 1000) + 86360;
        }

        // Update extras
        if (req.session.account.type === AccountType.MOJANG && req.session.account.mojangInfo) {
            if (req.session.account.mojangInfo.securityAnswers) {
                account.multiSecurity = req.session.account.mojangInfo.securityAnswers;
            }
        } else if (req.session.account.type === AccountType.MICROSOFT && req.session.account.microsoftInfo) {
            if (req.session.account.microsoftInfo.accessToken) {
                account.microsoftAccessToken = req.session.account.microsoftInfo.accessToken;
            }
            if (req.session.account.microsoftInfo.refreshToken) {
                account.microsoftRefreshToken = req.session.account.microsoftInfo.refreshToken;
            }
        }
        account.discordMessageSent = false;

        console.log(info("Saving updated details of " + (req.session.account.type) + " account #" + account.id + " " + req.body["uuid"]));
        await account.save();

        const generateTotal = account.successCounter + account.errorCounter;
        res.json({
            type: account.type || (account.microsoftAccount ? "microsoft" : "mojang"),
            username: account.username,
            email: account.email || account.username,
            uuid: account.uuid,
            lastUsed: account.lastUsed,
            enabled: account.enabled,
            successRate: Number((account.successCounter / generateTotal).toFixed(3)),
            successStreak: Math.round(account.successCounter / 10) * 10,
            discordLinked: !!account.discordUser,
            sendEmails: !!account.sendEmails,
            settings: {
                enabled: account.enabled,
                emails: account.sendEmails
            }
        })
    })

    app.put("/accountManager/settings/:setting", async (req: AccountManagerRequest, res: Response) => {
        if (!validateSessionAndToken(req, res)) return;
        if (!req.body["email"]) {
            res.status(400).json({ error: "missing credentials" });
            return;
        }
        if (!req.session || !req.session.account) {
            res.status(400).json({ error: "invalid session" });
            return;
        }
        const profileValidation = await getAndValidateMojangProfile(req.session.account!.token!, req.body["uuid"]);
        if (!profileValidation.valid || !profileValidation.profile) return;

        let updater: (account: IAccountDocument) => void;
        const setting = req.params["setting"];
        switch (setting) {
            case 'status':
                updater = account => {
                    account.enabled = !!req.body["enabled"]
                }
                break;
            case 'emails':
                updater = account => {
                    account.sendEmails = !!req.body["emails"];
                }
                break;
            default:
                res.status(404).json({ error: "unknown setting" });
                return;
        }
        if (!updater) return;

        const account = await Account.findOne({
            type: "external",
            uuid: profileValidation.profile.id,
            accountType: req.session.account.type,
            $or: [
                { email: req.session.account.email },
                { username: req.session.account.email }
            ]
        }).exec();
        if (!account) {
            res.status(404).json({ error: "account not found" });
            return;
        }
        updater(account);
        await account.save();
        res.json({
            success: true,
            msg: "updated"
        });
    })

    app.post("/accountManager/confirmAccountSubmission", async (req: AccountManagerRequest, res: Response) => {
        if (!validateSessionAndToken(req, res)) return;
        if (!req.body["email"] || !req.body["password"]) {
            res.status(400).json({ error: "missing credentials" });
            return;
        }
        if (!req.session || !req.session.account) {
            res.status(400).json({ error: "invalid session" });
            return;
        }
        if (req.body["email"] !== req.session.account.email) {
            res.status(400).json({ error: "invalid session" });
            return;
        }
        if (sha512(req.body["password"]) !== req.session.account.passwordHash) {
            res.status(400).json({ error: "invalid session" });
            return;
        }
        if (!req.body["uuid"]) {
            res.status(400).json({ error: "missing uuid" });
            return;
        }
        if (req.body["uuid"] !== req.session.account.uuid) {
            res.status(400).json({ error: "invalid session" });
            return;
        }
        const profileValidation = await getAndValidateMojangProfile(req.session.account!.token!, req.body["uuid"]);
        if (!profileValidation.valid || !profileValidation.profile) return;

        if (!req.body["checks"] || !req.body["checks"]["readTerms"] || !req.body["checks"]["acceptSkins"] || !req.body["checks"]["acceptPassword"]) {
            res.status(400).json({ error: "invalid checks" });
            return;
        }

        const ip = getIp(req);

        const preferredServer = await Generator.getPreferredAccountServer();
        if (preferredServer !== config.server) {
            console.warn("Got /confirmAccountSubmission but preferred server is " + preferredServer);
        }

        const lastAccount = await Account.findOne({}, "id").sort({ id: -1 }).lean().exec();
        const lastId = lastAccount?.id!;

        const account = new Account(<IAccountDocument>{
            id: lastId + 1,

            accountType: req.session.account.type,
            microsoftAccount: req.session.account.type === AccountType.MICROSOFT,

            username: req.session.account.email,
            email: req.session.account.email,

            passwordNew: Encryption.encrypt(base64decode(req.body["password"])),

            uuid: req.session.account.uuid,
            playername: profileValidation.profile.name,

            accessToken: req.session.account!.token!,
            accessTokenExpiration: Math.round(Date.now() / 1000) + 86360,
            accessTokenSource: req.session.account.type === AccountType.MICROSOFT ? AccessTokenSource.USER_LOGIN_MICROSOFT : AccessTokenSource.USER_LOGIN_MOJANG,
            clientToken: md5(req.session.account.email + "_" + ip),

            requestIp: ip,
            requestServer: config.server,
            timeAdded: Math.round(Date.now() / 1000),

            type: "external",
            enabled: true,
            lastUsed: 0,
            lastSelected: 0,
            forcedTimeoutAt: 0,
            errorCounter: 0,
            totalErrorCounter: 0,
            successCounter: 0,
            totalSuccessCounter: 0
        });
        if (req.session.account.type === AccountType.MICROSOFT) {
            account.microsoftUserId = req.session.account.microsoftInfo?.userId;
            account.microsoftAccessToken = req.session.account.microsoftInfo?.accessToken;
            account.microsoftRefreshToken = req.session.account.microsoftInfo?.refreshToken;
            account.minecraftXboxUsername = req.session.account.microsoftInfo?.username;
        } else if (req.session.account!.type === AccountType.MOJANG) {
            account.multiSecurity = req.session.account.mojangInfo?.securityAnswers;
        }

        console.log(info("Saving new " + (req.session.account.type) + " account #" + account.id + " " + req.body["uuid"]));
        await account.save();
        res.json({
            success: true,
            msg: "Account saved. Thanks for your contribution!"
        })

        Discord.notifyNewAccount(account);
    })

    app.delete("/accountManager/deleteAccount", async (req: AccountManagerRequest, res: Response) => {
        if (!validateSessionAndToken(req, res)) return;
        if (!req.body["email"]) {
            res.status(400).json({ error: "missing credentials" });
            return;
        }
        if (!req.session || !req.session.account) {
            res.status(400).json({ error: "invalid session" });
            return;
        }
        const profileValidation = await getAndValidateMojangProfile(req.session.account!.token!, req.body["uuid"]);
        if (!profileValidation.valid || !profileValidation.profile) return;

        const account = await Account.findOne({
            type: "external",
            uuid: profileValidation.profile.id,
            accountType: req.session.account.type,
            $or: [
                { email: req.session.account.email },
                { username: req.session.account.email }
            ]
        }).exec();
        if (!account) {
            res.status(404).json({ error: "account not found" });
            return;
        }
        if (account.enabled) {
            res.status(400).json({ error: "account needs to be disabled first" });
            return;
        }

        await account.deleteOne();
        res.json({
            success: true,
            msg: "account removed"
        });

        if (account.discordUser) {
            Discord.sendDiscordDirectMessage("Your MineSkin account " + account.uuid + " has been deleted.", account.discordUser);
        }
    })


    /// ACCOUNT LINKING

    app.get("/accountManager/discord/oauth/start", async (req: AccountManagerRequest, res: Response) => {
        if (!config.discord || !config.discord.oauth) {
            res.status(400).json({ error: "server can't handle discord auth" });
            return;
        }
        if (!req.session || !req.session.account) {
            res.status(400).json({ error: "invalid session" });
            return;
        }
        if (!req.session.account.token) {
            res.status(400).json({ error: "invalid session" });
            return;
        }
        if (!req.query["email"]) {
            res.status(400).json({ error: "missing credentials" });
            return;
        }
        if (!req.session || !req.session.account) {
            res.status(400).json({ error: "invalid session" });
            return;
        }
        const profileValidation = await getAndValidateMojangProfile(req.session.account!.token!, req.query["uuid"] as string);
        if (!profileValidation.valid || !profileValidation.profile) return;

        const account = await Account.findOne({
            type: "external",
            uuid: profileValidation.profile.id,
            accountType: req.session.account.type, //TODO: add $or to check for old ones
            $or: [
                { email: req.session.account.email },
                { username: req.session.account.email }
            ]
        }).exec();
        if (!account) {
            res.status(404).json({ error: "account not found" });
            return;
        }

        const clientId = config.discord.oauth.id;
        const redirect = encodeURIComponent(`https://${ config.server }.api.mineskin.org/accountManager/discord/oauth/callback`);
        const state = sha256(`${ account.getAccountType() }${ account.uuid }${ Math.random() }${ req.session.account.email! }${ Date.now() }${ account.id }`);

        Caching.storePendingDiscordLink({
            state: state,
            account: account.id,
            uuid: account.uuid,
            email: req.session.account.email!
        });

        res.redirect(`https://discordapp.com/api/oauth2/authorize?client_id=${ clientId }&scope=identify&response_type=code&state=${ state }&redirect_uri=${ redirect }`);
    })

    app.get("/accountManager/discord/oauth/callback", async (req: AccountManagerRequest, res: Response) => {
        if (!req.query["code"] || !req.query["state"]) {
            res.status(400).end();
            return;
        }
        if (!config.discord || !config.discord.oauth) {
            res.status(400).json({ error: "server can't handle discord auth" });
            return;
        }

        const pendingLink = Caching.getPendingDiscordLink(req.query["state"] as string);
        if (!pendingLink) {
            console.warn("Got a discord OAuth callback but the API wasn't expecting that linking request");
            res.status(400).json({ error: "invalid state" });
            return;
        }
        Caching.invalidatePendingDiscordLink(req.query["state"] as string);

        // Make sure the session isn't doing anything weird
        if (!req.session || !req.session.account) {
            console.warn("discord account link callback had invalid session");
            res.status(400).json({ error: "invalid session" });
            return;
        }
        const profileValidation = await getAndValidateMojangProfile(req.session.account.token!, pendingLink.uuid);
        if (!profileValidation.valid || !profileValidation.profile) return;

        const clientId = config.discord.oauth.id;
        const clientSecret = config.discord.oauth.secret;
        const redirect = `https://${ config.server }.api.mineskin.org/accountManager/discord/oauth/callback`;

        // Exchange code for token
        const form: any = {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "authorization_code",
            code: req.query["code"],
            redirect_uri: redirect,
            scope: "identify"
        };
        const tokenResponse = await Requests.axiosInstance.request({
            method: "POST",
            url: "https://discordapp.com/api/oauth2/token",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
                "Accept-Encoding": "gzip"
            },
            data: qs.stringify(form)
        });
        const tokenBody = tokenResponse.data;
        const accessToken = tokenBody["access_token"];
        if (!accessToken) {
            console.warn("Failed to get access token from discord");
            res.status(500).json({ error: "Discord API error" });
            return;
        }

        // Get user profile
        const userResponse = await Requests.axiosInstance.request({
            method: "GET",
            url: "https://discordapp.com/api/users/@me",
            headers: {
                "Authorization": `Bearer ${ accessToken }`,
                "Accept": "application/json",
                "Accept-Encoding": "gzip"
            }
        });
        const userBody = userResponse.data;

        const discordId = userBody["id"];
        if (!discordId) {
            console.warn("Discord response did not have an id field")
            res.status(404).json({ error: "Discord API error" });
            return;
        }

        const account = await Account.findOne({
            id: pendingLink.account,
            uuid: profileValidation.profile.id,
            $or: [
                { email: pendingLink.email },
                { username: pendingLink.email }
            ]
        }).exec();
        if (!account) {
            console.warn("account for discord linking callback not found");
            res.status(404).json({ error: "account not found" });
            return;
        }

        if (account.discordUser) {
            console.warn(warn("Account #" + account.id + " already has a linked discord user (#" + account.discordUser + "), changing to " + discordId));
        }
        account.discordUser = discordId;
        await account.save();

        console.log(info("Discord User " + userBody["username"] + "#" + userBody["discriminator"] + " linked to Mineskin account #" + account.id + "/" + account.uuid + " - adding roles!"));
        const roleAdded = await Discord.addDiscordAccountOwnerRole(discordId);
        Discord.sendDiscordDirectMessage("Thanks for linking your Discord account to Mineskin! :)", discordId);
        Discord.postDiscordMessage(userBody.username + "#" + userBody.discriminator + " <@" + discordId + "> linked to account #" + account.id + "/" + account.uuid);
        if (roleAdded) {
            res.json({
                success: true,
                msg: "Successfully linked Mineskin Account " + account.uuid + " to Discord User " + userBody.username + "#" + userBody.discriminator + ", yay! You can close this window now :)"
            });
        } else {
            res.json({
                success: false,
                msg: "Account " + account.uuid + " was linked to " + userBody.username + "#" + userBody.discriminator + ", but there was an issue updating your server roles :( - Make sure you've joined inventivetalent's discord server! (this may also happen if you've linked multiple accounts)"
            })
        }
    })

}

function validateSessionAndToken(req: AccountManagerRequest, res: Response): boolean {
    console.log(debug(req.headers.authorization))
    if (!req.headers.authorization || !req.headers.authorization.startsWith("Bearer ")) {
        res.status(400).json({ error: "invalid session" });
        return false;
    }
    console.log(debug(JSON.stringify(req.session)))
    const headerToken = req.headers.authorization.replace("Bearer ", "");
    if (!req.session || !req.session.account) {
        res.status(400).json({ error: "invalid session" });
        return false;
    }
    if (headerToken !== req.session.account.token) {
        res.status(400).json({ error: "invalid session" });
        return false;
    }
    return true;
}

function validateMultiSecurityAnswers(answers: any, req: Request, res: Response) {
    if (typeof answers !== "object" || answers.length < 3) {
        res.status(400).json({ error: "invalid security answers object (not an object / empty)" });
        return false;
    }
    for (let i = 0; i < answers.length; i++) {
        if ((!answers[i].hasOwnProperty("id") || !answers[i].hasOwnProperty("answer")) || (typeof answers[i].id !== "number" || typeof answers[i].answer !== "string")) {
            res.status(400).json({ error: "invalid security answers object (missing id / answer)" });
            return false;
        }
    }
    return true;
}

async function getMojangProfile(accessToken: string): Promise<Maybe<BasicMojangProfile>> {
    return Caching.getProfileByAccessToken(accessToken);
}

async function getAndValidateMojangProfile(accessToken: string, uuid: string): Promise<MojangProfileValidation> {
    if (!uuid || uuid.length < 32 || !accessToken) return { valid: false };
    const shortUuid = stripUuid(uuid);
    const profile = await getMojangProfile(accessToken);
    if (!profile || shortUuid !== profile.id) {
        throw new MineSkinError("invalid_credentials", "invalid credentials for uuid");
    }
    return {
        profile: profile,
        valid: shortUuid === profile.id
    }
}

function regenerateSession(req: AccountManagerRequest): Promise<void> {
    return new Promise<void>(resolve => {
        if (req.session) {
            req.session.regenerate(resolve);
        } else {
            resolve();
        }
    })
}

function destroySession(req: AccountManagerRequest): Promise<void> {
    return new Promise<void>(resolve => {
        if (req.session) {
            req.session.destroy(resolve);
        } else {
            resolve();
        }
    })
}

// session stuff

type AccountManagerRequest = MineSkinRequest & {
    session: AccountManagerSession;
}

type AccountManagerSession = session.Session & {
    account?: SessionAccountInfo;
}

interface SessionAccountInfo {
    type?: AccountType;
    email?: string;
    passwordHash?: string;
    token?: string;
    uuid?: string;

    mojangInfo?: MojangAccountInfo;
    microsoftInfo?: MicrosoftAccountInfo;
}

interface MojangAccountInfo {
    securityAnswers?: MojangSecurityAnswer[];
}

interface MicrosoftAccountInfo extends XboxInfo {
}


// other

interface MojangProfileValidation {
    profile?: BasicMojangProfile;
    valid: boolean;
}

export interface PendingDiscordLink {
    state: string;
    account: number;
    uuid: string;
    email: string;
}

