import { Application, Request, Response } from "express";
import { AuthenticationError, AuthError, BasicMojangProfile, Microsoft, Mojang, MojangSecurityAnswer, XboxInfo } from "../generator/Authentication";
import { base64decode, Encryption, getIp, info, Maybe, md5, sha512, stripUuid } from "../util";
import { IAccountDocument, MineSkinError } from "../types";
import * as session from "express-session";
import { Generator } from "../generator/Generator";
import { Config } from "../types/Config";
import { Account } from "../database/schemas";
import { AccessTokenSource, AccountType } from "../types/IAccountDocument";
import { Caching } from "../generator/Caching";

const config: Config = require("../config");

export const register = (app: Application) => {

    /// MOJANG

    app.post("/accountManager/mojang/login", async (req: AccountManagerRequest, res: Response) => {
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

        const challengeResponse = await Mojang.getChallenges(req.body["token"]).catch(err => {
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

        const solveResponse = await Mojang.submitChallengeAnswers(req.body["token"], answers).catch(err => {
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

        const ownsMinecraft = await Microsoft.checkGameOwnership(minecraftAccessToken);
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

    // Stuff that requires being logged in

    app.post("/accountManager/userProfile", async (req: AccountManagerRequest, res: Response) => {
        if (!validateSessionAndToken(req, res)) return;

        if (!req.body["uuid"]) {
            res.status(400).json({ error: "missing uuid" });
            return;
        }

        const profileValidation = await getAndValidateMojangProfile(req.body["token"], req.body["uuid"]);
        if (profileValidation.valid && profileValidation.profile) {
            if (req.session && req.session.account) {
                req.session.account.uuid = profileValidation.profile.id;
            }
            res.json(profileValidation.profile);
        }
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

        const profileValidation = await getAndValidateMojangProfile(req.body["token"], req.body["uuid"]);
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
        const profileValidation = await getAndValidateMojangProfile(req.body["token"], req.body["uuid"]);
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
        const profileValidation = await getAndValidateMojangProfile(req.body["token"], req.body["uuid"]);
        if (!profileValidation.valid || !profileValidation.profile) return;

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

            accessToken: req.body["token"],
            accessTokenExpiration: Math.round(Date.now() / 1000) + 86360,
            accessTokenSource: req.session.account.type === AccountType.MICROSOFT ? AccessTokenSource.USER_LOGIN_MICROSOFT : AccessTokenSource.USER_LOGIN_MOJANG,
            clientToken: md5(req.session.account.email + "_" + ip),

            requestIp: ip,
            requestServer: config.server,
            timeAdded: Math.round(Date.now() / 1000),

            enabled: true,
            lastUsed: 0,
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
        const profileValidation = await getAndValidateMojangProfile(req.body["token"], req.body["uuid"]);
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

        await account.remove();
        res.json({
            success: true,
            msg: "account removed"
        });
    })

}

function validateSessionAndToken(req: AccountManagerRequest, res: Response): boolean {
    if (!req.body["token"]) {
        res.status(400).json({ error: "missing token" });
        return false;
    }
    if (!req.session || !req.session.account) {
        res.status(400).json({ error: "invalid session" });
        return false;
    }
    if (req.body["token"] !== req.session.account.token) {
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

// session stuff

type AccountManagerRequest = Request & {
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


module.exports = function (app, config) {

    const util = require("../util");
    const urls = require("../generator/urls");
    const request = require("request").defaults({
        headers: {
            "Accept": "application/json, text/plain, */*",
            "Accept-Encoding": "gzip, deflate",
            "Origin": "mojang://launcher",
            "User-Agent": "MineSkin.org" /*"Minecraft Launcher/2.1.2481 (bcb98e4a63) Windows (10.0; x86_64)"*/,
            "Content-Type": "application/json;charset=UTF-8"
        }
    });
    const md5 = require("md5");
    const authentication = require("../generator/Authentication");
    const { URL } = require("url");
    const metrics = require("../util/metrics");

    const pendingDiscordLinks = {};

    // Schemas
    const Account = require("../database/schemas/Account").IAccountDocument;
    const Skin = require("../database/schemas/Skin").ISkinDocument;


    app.get("/accountManager/listAccounts", function (req, res) {
        Account.find({}, "id lastUsed enabled errorCounter successCounter type", function (err, accounts) {
            if (err) return console.log(err);

            const accs = [];
            accounts.forEach(function (acc) {
                if (!acc.successCounter) acc.successCounter = 0;
                if (!acc.errorCounter) acc.errorCounter = 0;
                const total = acc.successCounter + acc.errorCounter;
                accs.push({
                    id: acc.id,
                    lastUsed: acc.lastUsed,
                    enabled: acc.enabled,
                    type: acc.type,
                    successRate: Number((acc.successCounter / total).toFixed(3))
                })
            });
            res.json(accs)
        })
    });

    app.get("/accountManager/discord/oauth/start", function (req, res) {
        if (!req.query.token) {
            res.status(400).json({ error: "Missing token" })
            return;
        }
        if (!req.query.username) {
            res.status(400).json({ error: "Missing username" })
            return;
        }
        if (!req.query.uuid) {
            res.status(400).json({ error: "Missing UUID" })
            return;
        }

        getProfile(req.query.token, function (response, profileBody) {
            if (profileBody.error) {
                res.status(response.statusCode).json({ error: profileBody.error, msg: profileBody.errorMessage })
            } else {
                if (profileBody.id !== req.query.uuid) {
                    res.status(400).json({ error: "uuid mismatch" })
                    return;
                }

                Account.findOne({ username: req.query.username, uuid: req.query.uuid }, "id username uuid", function (err, account) {
                    if (err) return console.log(err);
                    if (!account) {
                        res.status(404).json({ error: "Account not found" })
                        return;
                    }

                    let clientId = config.discord.oauth.id;
                    let redirect = encodeURIComponent("https://" + (config.server ? config.server + "." : "") + "api.mineskin.org/accountManager/discord/oauth/callback");

                    let state = md5(account.uuid + "_" + account.username + "_magic_discord_string_" + Date.now() + "_" + account.id);

                    pendingDiscordLinks[state] = {
                        account: account.id,
                        uuid: account.uuid
                    };

                    res.redirect('https://discordapp.com/api/oauth2/authorize?client_id=' + clientId + '&scope=identify&response_type=code&state=' + state + '&redirect_uri=' + redirect);
                })
            }
        })
    });

    app.get("/accountManager/discord/oauth/callback", function (req, res) {
        if (!req.query.code) {
            res.status(400).json({
                error: "Missing code"
            });
            return;
        }
        const redirect = "https://" + (config.server ? config.server + "." : "") + "api.mineskin.org/accountManager/discord/oauth/callback";
        request({
            url: "https://discordapp.com/api/oauth2/token",
            method: "POST",
            form: {
                client_id: config.discord.oauth.id,
                client_secret: config.discord.oauth.secret,
                grant_type: "authorization_code",
                code: req.query.code,
                redirect_uri: redirect,
                scope: "identify"
            },
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            gzip: true,
            json: true
        }, function (err, tokenResponse, tokenBody) {
            if (err) {
                console.warn(err);
                res.status(500).json({
                    error: "Discord API error",
                    state: "oauth_token"
                });
                return;
            }

            console.log(tokenBody);
            if (!tokenBody.access_token) {
                res.status(500).json({
                    error: "Discord API error",
                    state: "oauth_access_token"
                });
                return;
            }

            request({
                url: "https://discordapp.com/api/users/@me",
                method: "GET",
                auth: {
                    bearer: tokenBody.access_token
                },
                gzip: true,
                json: true
            }, function (err, profileResponse, profileBody) {
                if (err) {
                    console.warn(err);
                    res.status(500).json({
                        error: "Discord API error",
                        state: "profile"
                    });
                    return;
                }

                if (!req.query.state) {
                    res.status(400).json({
                        error: "Missing state"
                    });
                    return;
                }
                if (!pendingDiscordLinks.hasOwnProperty(req.query.state)) {
                    console.warn("Got a discord OAuth callback but the API wasn't expecting that linking request");
                    res.status(400).json({
                        error: "API not waiting for this link"
                    });
                    return;
                }
                const linkInfo = pendingDiscordLinks[req.query.state];
                delete pendingDiscordLinks[req.query.state];

                console.log(profileBody);

                if (!profileBody.id) {
                    res.status(404).json({ error: "Missing profile id in discord response" })
                    return;
                }

                Account.findOne({ id: linkInfo.account, uuid: linkInfo.uuid }, function (err, account) {
                    if (err) return console.log(err);
                    if (!account) {
                        res.status(404).json({ error: "Account not found" })
                        return;
                    }

                    if (account.discordUser) {
                        console.warn("Account #" + account.id + " already has a linked discord user (#" + account.discordUser + "), changing to " + profileBody.id);
                    }

                    account.discordUser = profileBody.id;
                    account.save(function (err, acc) {
                        if (err) {
                            console.warn(err);
                            res.status(500).json({ error: "Unexpected error" })
                            return;
                        }

                        console.log("Linking Discord User " + profileBody.username + "#" + profileBody.discriminator + " to Mineskin account #" + linkInfo.account + "/" + linkInfo.uuid);
                        addDiscordRole(profileBody.id, function (b) {
                            if (b) {
                                res.json({
                                    success: true,
                                    msg: "Successfully linked Mineskin Account " + account.uuid + " to Discord User " + profileBody.username + "#" + profileBody.discriminator + ", yay! You can close this window now :)"
                                });
                                util.sendDiscordDirectMessage("Thanks for linking your Discord account to Mineskin! :)", profileBody.id);
                            } else {
                                res.json({
                                    success: false,
                                    msg: "Uh oh! Looks like there was an issue linking your discord account! Make sure you've joined inventivetalent's discord server and try again"
                                })
                            }
                        });
                    })
                });
            })
        })
    });

    app.post("/accountManager/authInterceptor/reportGameLaunch", function (req, res) {
        console.log("authInterceptor/reportGameLaunch");

        if (typeof req.body !== "object" || !req.body.hasOwnProperty("a")) {
            res.stats(400).json({
                success: false,
                msg: "invalid request"
            });
            return;
        }

        const buffer = Buffer.from(req.body.a, "base64");
        if (buffer.length !== 416) {
            res.stats(400).json({
                success: false,
                msg: "invalid request"
            });
            return;
        }

        const nameLength = buffer[0];
        console.log("Name Length: " + nameLength);
        if (nameLength > 16) {
            res.stats(400).json({
                success: false,
                msg: "invalid request"
            });
            return;
        }
        let name = "";
        for (let i = 0; i < nameLength; i++) {
            name += String.fromCharCode(buffer[4 + i] ^ 4);
        }
        console.log("Name: " + name);

        const uuidLength = buffer[1];
        console.log("UUID Length: " + uuidLength);
        if (uuidLength !== 32) {
            res.stats(400).json({
                success: false,
                msg: "invalid request"
            });
            return;
        }
        let uuid = "";
        for (let i = 0; i < uuidLength; i++) {
            uuid += String.fromCharCode(buffer[4 + 16 + i] ^ 8);
        }
        console.log("UUID: " + uuid);

        const tokenLength = buffer[2] + buffer[3];
        console.log("Token Length: " + tokenLength);
        if (tokenLength !== 357) {
            res.stats(400).json({
                success: false,
                msg: "invalid request"
            });
            return;
        }
        let token = "";
        for (let i = 0; i < tokenLength; i++) {
            token += String.fromCharCode(buffer[4 + 16 + 32 + i] ^ 16);
        }
        console.log("Token: [redacted]");

        Account.findOne({ uuid: uuid, playername: name, authInterceptorEnabled: true }, function (err, account) {
            if (err) return console.log(err);
            if (!account) {
                res.status(404).json({ error: "Account not found" })
                return;
            }

            account.accessToken = token;

            account.save(function (err, acc) {
                if (err) {
                    console.warn(err);
                    res.status(500).json({ error: "Unexpected error" })
                    return;
                }

                console.log("Access Token updated for Account #" + acc.id + " via AuthInterceptor");
                res.status(200).json({ success: true })
            })
        })

    });


    function validateMultiSecurityAnswers(answers, req, res) {
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

};
