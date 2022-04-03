import { Application, Request, Response } from "express";
import { Authentication, AuthenticationError, AuthError, BasicMojangProfile, Microsoft, Mojang, MojangSecurityAnswer, XboxInfo } from "../generator/Authentication";
import { base64decode, corsWithCredentialsMiddleware, getIp, Maybe, md5, sha1, sha256, sha512, sleep, stripUuid } from "../util";
import session from "express-session";
import { Generator } from "../generator/Generator";
import { Account } from "../database/schemas";
import { Caching } from "../generator/Caching";
import { Requests } from "../generator/Requests";
import qs from "querystring";
import { Discord } from "../util/Discord";
import { getConfig, MineSkinConfig } from "../typings/Configs";
import { AccessTokenSource, AccountType, IAccountDocument } from "../typings/db/IAccountDocument";
import { MineSkinError, MineSkinRequest } from "../typings";
import { Encryption } from "../util/Encryption";
import { info, warn } from "../util/colors";
import * as Sentry from "@sentry/node";
import { Time } from "@inventivetalent/time";
import { PendingDiscordAccountLink } from "../typings/DiscordAccountLink";
import { v4 as randomUuid } from "uuid"
import { Buffer } from "buffer";
import { randomBytes } from "crypto";
import { MicrosoftAuthInfo } from "../typings/MicrosoftAuthInfo";
import { getUserFromRequest } from "./account";

export const register = (app: Application, config: MineSkinConfig) => {

    app.use("/accountManager", corsWithCredentialsMiddleware);
    app.use("/accountManager", session({
        secret: config.sessionSecret,
        resave: false,
        saveUninitialized: true,
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

        const config = await getConfig();
        const existingServer = await Authentication.getExistingAccountServer(req.body["email"]);
        if (existingServer && existingServer !== config.server) {
            res.json({
                success: false,
                switchToServer: {
                    server: existingServer,
                    host: `${ existingServer }.api.mineskin.org`
                }
            })
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

    // @deprecated (non-oauth version)
    app.post("/accountManager/microsoft/login", async (req: AccountManagerRequest, res: Response) => {
        await regenerateSession(req);
        if (!req.body["email"] || !req.body["password"]) {
            res.status(400).json({ error: "missing login data" });
            return;
        }

        const config = await getConfig();
        const existingServer = await Authentication.getExistingAccountServer(req.body["email"]);
        if (existingServer && existingServer !== config.server) {
            res.json({
                success: false,
                switchToServer: {
                    server: existingServer,
                    host: `${ existingServer }.api.mineskin.org`
                }
            })
            return;
        }

        let microsoftInfo = undefined;
        const minecraftAccessToken = await Microsoft.loginWithEmailAndPassword(req.body["email"], base64decode(req.body["password"]), xboxInfo => {
            microsoftInfo = xboxInfo;
        }).catch(err => {
            console.log(err);
            if (err.name === "XboxReplayError") {
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

        res.json({
            success: true,
            finalize: true
        })
    })

    app.post("/accountManager/microsoft/login/finalize", async (req: AccountManagerRequest, res: Response) => {
        if (!req.session || !req.session.account || !req.session.account.token) {
            res.status(400).json({ error: "invalid session (token)" });
            return;
        }

        const minecraftAccessToken = req.session.account.token;
        const ownsMinecraft = await Microsoft.checkGameOwnership(minecraftAccessToken)
            .catch(err => {
                if (err.response) {
                    throw new AuthenticationError(AuthError.DOES_NOT_OWN_MINECRAFT, "Failed to check game ownership", undefined, err);
                }
                throw err;
            });
        if (!ownsMinecraft) {
            if (req.session.account.gamePass) {
                console.warn(warn("User " + req.session.account.email + " does not own minecraft, but apparently it's a game pass account!"));
                const profile = await Caching.getProfileByAccessToken(minecraftAccessToken);
                if (!profile || !profile.id) {
                    throw new AuthenticationError(AuthError.DOES_NOT_OWN_MINECRAFT, "User does not own minecraft (game pass)", undefined);
                }
            } else {
                throw new AuthenticationError(AuthError.DOES_NOT_OWN_MINECRAFT, "User does not own minecraft", undefined);
            }
        }

        res.json({
            success: !!minecraftAccessToken,
            token: minecraftAccessToken,
            email: req.session.account.email,
            ownsMinecraft: ownsMinecraft,
            gamePass: req.session.account.gamePass
        });
    })

    // MICROSOFT OAUTH

    app.get("/accountManager/microsoft/oauth/start", async (req: AccountManagerRequest, res: Response) => {
        const config = await getConfig();
        if (!config.microsoft?.clientId) {
            res.status(500).json({ error: "server can't handle microsoft auth" });
            return;
        }

        const state = config.server + '_' + sha256(Buffer.concat([Buffer.from(randomUuid(), 'utf8'), randomBytes(16)]).toString('base64'));

        Caching.storePendingMicrosoftLink(state, {
            state: state,
            email: req.query.email as string,
            gamePass: req.query.gamePass === 'true'
        });

        const scopes = ["XboxLive.signin", "offline_access"].join("%20");
        const redirect = `https://${ config.server }.api.mineskin.org/accountManager/microsoft/oauth/callback`;
        let url = `https://login.live.com/oauth20_authorize.srf?client_id=${ config.microsoft.clientId }&response_type=code&redirect_uri=${ redirect }&scope=${ scopes }&state=${ state }`;
        if (!req.query["email"]) {
            url += '&prompt=select_account';
        } else {
            url += `&prompt=login&login_hint=${ req.query["email"] }`;
        }
        res.redirect(url);
    });

    app.get("/accountManager/microsoft/oauth/callback", async (req: AccountManagerRequest, res: Response) => {
        if (req.query["error_description"]) {
            res.status(400).json({ error: req.query["error_description"] });
            return;
        }

        if (!req.query["state"]) {
            res.status(400).json({ error: "missing state" });
            return;
        }
        if (!req.query["code"]) {
            res.status(400).json({ error: "missing code" });
            return;
        }

        let stateSplit = (req.query['state'] as string).split('_');
        if (config.server != stateSplit[0]) {
            // redirect to correct server
            res.redirect(`https://${ stateSplit[0] }.api.mineskin.org/accountManager/microsoft/oauth/callback?code=${ req.query['code'] }&state=${ req.query['state'] }`);
            return;
        }

        const pendingLink = Caching.getPendingMicrosoftLink(req.query["state"] as string);
        if (!pendingLink) {
            res.status(403).json({ error: "invalid state" });
            return;
        }
        const code = req.query["code"] as string;

        let microsoftInfo = undefined;
        const minecraftAccessToken = await Microsoft.loginWithXboxCode(code, info => {
            microsoftInfo = info;
        })

        req.session.account = {
            type: AccountType.MICROSOFT,
            token: minecraftAccessToken,
            microsoftInfo: microsoftInfo,
            email: pendingLink.email,
            gamePass: pendingLink.gamePass
        };

        res.send(`
            <noscript>
                You can close this window now.
            </noscript>
            <script>
                window.close();
            </script>
        `)
    });


    /// INDEPENDENT

    app.post("/accountManager/logout", async (req: AccountManagerRequest, res: Response) => {
        req.session.destroy(() => res.status(200).end());
    })

    app.get("/accountManager/preferredAccountServer", async (req: Request, res: Response) => {
        try {
            let server = await Generator.getPreferredAccountServer(req.query["type"] as string);
            server = await Generator.getServerFromProxy(server);
            res.json({
                server: server,
                host: `${ server }.api.mineskin.org`
            });
        } catch (e) {
            Sentry.captureException(e);
            res.status(404).json({ error: "failed to get server" });
        }
    })

    // Stuff that requires being logged in

    app.post("/accountManager/userProfile", async (req: AccountManagerRequest, res: Response) => {
        if (!validateSessionAndToken(req, res)) return;

        const profile = await Caching.getProfileByAccessToken(req.session.account!.token!);
        if (!profile) {
            res.status(400).json({ error: "invalid session (profile)" });
            return;
        }
        if (req.session && req.session.account) {
            req.session.account.uuid = profile.id;
        }
        res.json(profile);
    });

    app.post("/accountManager/myAccount", async (req: AccountManagerRequest, res: Response) => {
        if (!validateSessionAndToken(req, res)) return;
        if (!req.session || !req.session.account) {
            res.status(400).json({ error: "invalid session (account)" });
            return;
        }

        const config = await getConfig();
        const profileValidation = await getAndValidateMojangProfile(req.session.account!.token!, req.body["uuid"]);
        if (!profileValidation.valid || !profileValidation.profile) {
            res.status(400).json({ error: "profile validation failed" });
            return;
        }

        const account = await findAccountForSession({
            type: "external",
            accountType: req.session.account.type
        }, profileValidation, req, res);
        if (!account) {
            return;
        }
        if (account.uuid !== req.body["uuid"]) {
            //wth
            return;
        }

        // Update password
        if (req.body["password"] && req.body["password"].length > 3) {
            account.passwordNew = await Encryption.encrypt(base64decode(req.body["password"]));
        } else if (account.accountType === AccountType.MICROSOFT) {
            // probably new microsoft login, reset it
            account.passwordNew = undefined;
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
            if (req.session.account.microsoftInfo.XSTSToken) {
                account.microsoftXSTSToken = req.session.account.microsoftInfo.XSTSToken;
            }
            if (req.session.account.microsoftInfo.accessToken) {
                account.microsoftAccessToken = req.session.account.microsoftInfo.accessToken;
            }
            if (req.session.account.microsoftInfo.refreshToken) {
                account.microsoftRefreshToken = req.session.account.microsoftInfo.refreshToken;
            }
            if (req.session.account.microsoftInfo.msa) {
                account.microsoftAuth = req.session.account.microsoftInfo.msa;
            }
        }

        const user = await getUserFromRequest(req, res, false);
        if (!!user && user.uuid) { //TODO: should probably reject request if there's a linked user on the account but not in the request
            if (!account.user) {
                account.user = user.uuid;
                Discord.postDiscordMessage(`👤 [${ config.server }] Account ${ account.id }/${ account.uuid } linked to user ${ user.uuid }/${ user.email }`);
            } else if (account.user && account.user !== user.uuid) {
                Discord.postDiscordMessage(`👤 [${ config.server }] Got account login for ${ account.id }/${ account.uuid } by different user that linked one; linked: ${ account.user } request: ${ user.uuid }`);
            }

            if (!account.email && user.email) {
                account.email = user.email;
            }
            if (!account.discordUser && user.discordId) {
                account.discordUser = user.discordId;

                addDiscordOwnerRole(account, user.discordId, "user:" + user.uuid);
            }
        }

        const hadSentMessage = account.discordMessageSent || account.emailSent || false;
        account.discordMessageSent = false;
        account.emailSent = false;

        const generateTotal = account.totalSuccessCounter + account.totalErrorCounter;
        const recentTotal = account.successCounter + account.errorCounter;

        const roundedSuccessCount = Math.floor(account.totalSuccessCounter / 100) * 100;

        const successRate = generateTotal === 0 ? 0 : account.totalSuccessCounter / generateTotal;
        const recentSuccessRate = recentTotal === 0 ? 0 : account.successCounter / recentTotal;

        const hadErrors = account.errorCounter > 0;
        account.errorCounter = 0;

        Discord.postDiscordMessage("👤 Account " + account.id + "/" + account.uuid + " updated due to manual login (linked to " + account.email + "/<@" + account.discordUser + ">)" +
            "    hadSentMessage: " + hadSentMessage + ", hadErrors: " + hadErrors);

        if (!account.requestServer) {
            account.requestServer = await Generator.getPreferredAccountServer(account.accountType);
            Discord.postDiscordMessage("👤 Account " + account.id + "/" + account.uuid + " moved to " + account.requestServer);
        }

        console.log(info("Saving updated details of " + (req.session.account.type) + " account #" + account.id + " " + req.body["uuid"]));
        await account.save();

        res.json({
            type: account.accountType || (account.microsoftAccount ? "microsoft" : "mojang"),
            username: account.username,
            email: account.email || account.username,
            gamerTag: account.microsoftAuth?.identities?.xbox?.claims.gtg,
            uuid: account.uuid,
            user: user?.uuid,
            lastUsed: account.lastUsed,
            enabled: account.enabled,
            usable: account.errorCounter < config.errorThreshold,
            successCount: roundedSuccessCount,
            successRate: Number(successRate.toFixed(3)),
            recentSuccessRate: Number(recentSuccessRate.toFixed(3)),
            successStreak: Math.round(account.successCounter / 10) * 10,
            discordLinked: !!account.discordUser,
            sendEmails: !!account.sendEmails,
            hadSentMessage: hadSentMessage,
            hadErrors: hadErrors,
            hiatus: {
                enabled: account.hiatus?.enabled ?? false,
                onHiatus: account.isOnHiatus(),
                lastPing: account.hiatus?.lastPing ?? 0,
                token: account.hiatus?.token
            },
            settings: {
                enabled: account.enabled,
                emails: account.sendEmails,
                hiatus: account.hiatus?.enabled ?? false
            }
        })
    })

    async function findAccountForSession(query: any, profileValidation: MojangProfileValidation, req: AccountManagerRequest, res: Response): Promise<Maybe<IAccountDocument>> {
        if (!req.session.account) return undefined;
        query["uuid"] = profileValidation.profile!.id;
        if (req.session.account.email) { // probably mojang or old microsoft auth
            query["email"] = req.session.account.email;
        } else if (req.session.account.microsoftInfo) { // microsoft account
            // query["microsoftUserId"] = req.session.account.microsoftInfo.userId
            query["minecraftXboxUsername"] = req.session.account.microsoftInfo.username;
        } else {
            res.status(400).json({ error: "invalid account request" });
            return undefined;
        }
        console.log(query);
        const account = await Account.findOne(query).exec();
        if (!account) {
            res.status(404).json({ error: "account not found" });
            return undefined;
        }
        return account;
    }

    app.put("/accountManager/settings/:setting", async (req: AccountManagerRequest, res: Response) => {
        if (!validateSessionAndToken(req, res)) return;
        if (!req.session || !req.session.account) {
            res.status(400).json({ error: "invalid session (account)" });
            return;
        }
        const profileValidation = await getAndValidateMojangProfile(req.session.account!.token!, req.body["uuid"]);
        if (!profileValidation.valid || !profileValidation.profile) return;

        let updater: (account: IAccountDocument) => any;
        const setting = req.params["setting"];
        switch (setting) {
            case 'status':
                updater = account => {
                    account.enabled = !!req.body["enabled"]

                    Discord.postDiscordMessage("👤 Account " + account.id + "/" + account.uuid + " " + (account.enabled ? "enabled" : "disabled") + " (linked to " + account.email + "/<@" + account.discordUser + ">)");

                    if (account.enabled) {
                        Generator.saveOriginalSkin(account, false); // save current skin before using the account again
                    }
                    //TODO: restore skin
                }
                break;
            case 'emails':
                updater = account => {
                    account.sendEmails = !!req.body["emails"];
                }
                break;
            case 'email':
                updater = account => {
                    account.email = req.body["email"];
                }
                break;
            case 'hiatus':
                updater = account => {
                    if (!account.hiatus) {
                        account.hiatus = {
                            enabled: false,
                            lastLaunch: 0,
                            lastPing: 0,
                            token: ""
                        }
                    }

                    account.hiatus.enabled = !!req.body["hiatus"];
                    if (account.hiatus.enabled) {
                        Discord.postDiscordMessage("👤 Hiatus enabled for account " + account.id + "/" + account.uuid);

                        let token = sha1(randomUuid() + Math.random() + Date.now() + randomUuid());
                        token = account.uuid.substring(0, 4) + token.substring(4, token.length - 4) + account.uuid.substring(account.uuid.length - 4, account.uuid.length);
                        account.hiatus.token = token;
                        return account.hiatus.token;
                    }
                    return undefined;
                }
                break;
            default:
                res.status(404).json({ error: "unknown setting" });
                return;
        }
        if (!updater) return;

        const account = await findAccountForSession({
            type: "external",
            accountType: req.session.account.type
        }, profileValidation, req, res);
        if (!account) {
            return;
        }
        let result = updater(account);
        await account.save();
        let resp: any = {
            success: true,
            msg: "updated"
        };
        if (result) {
            resp.result = result;
        }
        res.json(resp);
    })

    app.post("/accountManager/confirmAccountSubmission", async (req: AccountManagerRequest, res: Response) => {
        if (!validateSessionAndToken(req, res)) return;
        if (!req.session || !req.session.account) {
            res.status(400).json({ error: "invalid session (account)" });
            return;
        }
        if (req.session.account.type === AccountType.MOJANG) {
            if (req.body["email"] !== req.session.account.email) {
                res.status(400).json({ error: "invalid session (email)" });
                return;
            }
            console.log(req.session.account)
            console.log(sha512(req.body["password"]))
            if (sha512(req.body["password"]) !== req.session.account.passwordHash) {
                res.status(400).json({ error: "invalid session (password)" });
                return;
            }
        }
        if (!req.body["uuid"]) {
            res.status(400).json({ error: "missing uuid" });
            return;
        }
        if (req.body["uuid"] !== req.session.account.uuid) {
            res.status(400).json({ error: "invalid session (uuid)" });
            return;
        }
        const profileValidation = await getAndValidateMojangProfile(req.session.account!.token!, req.body["uuid"]);
        if (!profileValidation.valid || !profileValidation.profile) return;

        if (!req.body["checks"] || !req.body["checks"]["readTerms"] || !req.body["checks"]["acceptSkins"] || !req.body["checks"]["acceptPassword"]) {
            res.status(400).json({ error: "invalid checks" });
            return;
        }

        const ip = getIp(req);

        const preferredServer = await Generator.getPreferredAccountServer(req.session.account.type);
        if (preferredServer !== config.server) {
            console.warn("Got /confirmAccountSubmission but preferred server is " + preferredServer);
        }

        const lastAccount = await Account.findOne({}, "id").sort({ id: -1 }).lean().exec();
        const lastId = lastAccount?.id!;

        const account = new Account(<IAccountDocument>{
            id: lastId + 1,

            accountType: req.session.account.type,
            microsoftAccount: req.session.account.type === AccountType.MICROSOFT,

            uuid: req.session.account.uuid,
            playername: profileValidation.profile.name,

            accessToken: req.session.account!.token!,
            accessTokenExpiration: Math.round(Date.now() / 1000) + 86360,
            accessTokenSource: req.session.account.type === AccountType.MICROSOFT ? AccessTokenSource.USER_LOGIN_MICROSOFT : AccessTokenSource.USER_LOGIN_MOJANG,
            clientToken: md5(req.session.account.uuid + "_" + ip),

            requestIp: ip,
            requestServer: config.server,
            timeAdded: Math.round(Date.now() / 1000),

            type: "external",
            enabled: true,
            sendEmails: false,
            lastUsed: 0,
            lastSelected: 0,
            forcedTimeoutAt: 0,
            errorCounter: 0,
            totalErrorCounter: 0,
            successCounter: 0,
            totalSuccessCounter: 0,
            ev: 0 //TODO
        });
        if (req.session.account.type === AccountType.MICROSOFT) {
            account.microsoftUserHash = req.session.account.microsoftInfo?.userHash;
            account.microsoftUserId = req.session.account.microsoftInfo?.userId;
            account.minecraftXboxUsername = req.session.account.microsoftInfo?.username;
            account.microsoftXSTSToken = req.session.account.microsoftInfo?.XSTSToken;
            account.microsoftAccessToken = req.session.account.microsoftInfo?.accessToken;
            account.microsoftRefreshToken = req.session.account.microsoftInfo?.refreshToken;
            account.microsoftAuth = req.session.account.microsoftInfo?.msa as MicrosoftAuthInfo;
            account.gamePass = req.session.account.gamePass;
        } else if (req.session.account!.type === AccountType.MOJANG) {
            account.passwordNew = await Encryption.encrypt(base64decode(req.body["password"]));
            account.multiSecurity = req.session.account.mojangInfo?.securityAnswers;
        }

        if (req.session.account.email) {
            account.email = req.session.account.email;
            account.sendEmails = true;
            account.username = req.session.account.email;
        }

        const user = await getUserFromRequest(req, res, false);
        if (!!user && user.uuid) {
            account.user = user.uuid;
            if (!account.email && user.email) {
                account.email = user.email;
            }
            if (user.discordId) {
                account.discordUser = user.discordId;

                addDiscordOwnerRole(account, user.discordId, "user:" + user.uuid);
            }
            Discord.postDiscordMessage(`👤 [${ config.server }] Account ${ account.id }/${ account.uuid } linked to user ${ user.uuid }/${ user.email }`);
        }


        console.log(info("Saving new " + (req.session.account.type) + " account #" + account.id + " " + req.body["uuid"]));
        await account.save();
        res.json({
            success: true,
            msg: "Account saved. Thanks for your contribution!"
        })

        Discord.notifyNewAccount(account, req);

        // Disable mojang accounts just migrated to microsoft
        //  or accounts that just managed to sneak in twice
        Account.updateMany({
            id: { $ne: account.id },
            enabled: true,
            uuid: account.uuid
        }, {
            $set: {
                enabled: false
            }
        }).exec().then(updateResult => {
            if (updateResult.nModified > 0) {
                Discord.postDiscordMessage(`Disabled ${ updateResult.nModified } account with the same uuid (${ account.uuid }) as a newly added ${ account.accountType } account (#${ account.id })`);
            }
        })

        await Generator.saveOriginalSkin(account);
    })

    app.delete("/accountManager/deleteAccount", async (req: AccountManagerRequest, res: Response) => {
        if (!validateSessionAndToken(req, res)) return;
        if (!req.session || !req.session.account) {
            res.status(400).json({ error: "invalid session (account)" });
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

        const deleteResult = await Account.deleteOne({
            type: "external",
            uuid: profileValidation.profile.id
        })

        await sleep(1000);

        await destroySession(req);

        if ((deleteResult?.deletedCount || 0) < 1) {
            res.json({
                success: false,
                msg: "failed to delete that account"
            });

            Discord.postDiscordMessage("👤 Account " + account.id + "/" + account.uuid + " failed to delete");
        } else {
            res.json({
                success: true,
                msg: "account removed"
            });

            Discord.postDiscordMessage("👤 Account " + account.id + "/" + account.uuid + " deleted (was linked to " + account.email + "/<@" + account.discordUser + ">)");
        }

        if (account.discordUser) {
            Discord.sendDiscordDirectMessage("Your MineSkin account " + account.uuid + " has been deleted.", account.discordUser);
        }


    })


    /// ACCOUNT LINKING

    app.get("/accountManager/discord/oauth/start", async (req: AccountManagerRequest, res: Response) => {
        const config = await getConfig();
        if (!config.discordAccount) {
            res.status(400).json({ error: "server can't handle discord auth" });
            return;
        }
        if (!req.session || !req.session.account) {
            res.status(400).json({ error: "invalid session (account)" });
            return;
        }
        if (!req.session.account.token) {
            res.status(400).json({ error: "invalid session (token)" });
            return;
        }
        if (!req.session || !req.session.account) {
            res.status(400).json({ error: "invalid session (account)" });
            return;
        }
        const profileValidation = await getAndValidateMojangProfile(req.session.account!.token!, req.query["uuid"] as string);
        if (!profileValidation.valid || !profileValidation.profile) return;

        const account = await findAccountForSession({
            type: "external",
            accountType: req.session.account.type
        }, profileValidation, req, res);
        if (!account) {
            return;
        }

        const clientId = config.discordAccount.id;
        const redirect = encodeURIComponent(`https://api.mineskin.org/accountManager/discord/oauth/callback`);
        const state = config.server + '_' + sha256(`${ account.getAccountType() }${ account.uuid }${ Math.random() }${ req.session.account.email! }${ Date.now() }${ account.id }`);

        Caching.storePendingDiscordLink(<PendingDiscordAccountLink>{
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
        const config = await getConfig();
        let stateSplit = (req.query['state'] as string).split('_');
        if (config.server != stateSplit[0]) {
            // redirect to correct server
            res.redirect(`https://${ stateSplit[0] }.api.mineskin.org/accountManager/discord/oauth/callback?code=${ req.query['code'] }&state=${ req.query['state'] }`);
            return;
        }
        if (!config.discordAccount) {
            res.status(400).json({ error: "server can't handle discord auth" });
            return;
        }

        const pendingLink: Maybe<PendingDiscordAccountLink> = Caching.getPendingDiscordLink(req.query["state"] as string);
        if (!pendingLink) {
            console.warn("Got a discord OAuth callback but the API wasn't expecting that linking request");
            res.status(400).json({ error: "invalid state" });
            return;
        }
        Caching.invalidatePendingDiscordLink(req.query["state"] as string);

        // Make sure the session isn't doing anything weird
        if (!req.session || !req.session.account) {
            console.warn("discord account link callback had invalid session");
            res.status(400).json({ error: "invalid session (account)" });
            return;
        }
        const profileValidation = await getAndValidateMojangProfile(req.session.account.token!, pendingLink.uuid!);
        if (!profileValidation.valid || !profileValidation.profile) return;

        const clientId = config.discordAccount.id;
        const clientSecret = config.discordAccount.secret;
        const redirect = `https://api.mineskin.org/accountManager/discord/oauth/callback`;

        // Exchange code for token
        const form: any = {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "authorization_code",
            code: req.query["code"],
            redirect_uri: redirect,
            scope: "identify"
        };
        const tokenResponse = await Requests.genericRequest({
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
        const userResponse = await Requests.genericRequest({
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

        const account = await findAccountForSession({
            id: pendingLink.account
        }, profileValidation, req, res);
        if (!account) {
            console.warn("account for discord linking callback not found");
            return;
        }

        const roleAdded = await addDiscordOwnerRole(account, discordId, userBody.username + "#" + userBody.discriminator);
        await account.save();
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

    async function addDiscordOwnerRole(account: IAccountDocument, discordId: string, discordUsername: string): Promise<boolean> {
        if (account.discordUser) {
            console.warn(warn("Account #" + account.id + " already has a linked discord user (#" + account.discordUser + "), changing to " + discordId));
        }
        account.discordUser = discordId;

        console.log(info("Discord User " + discordUsername + " linked to Mineskin account #" + account.id + "/" + account.uuid + " - adding roles!"));
        const roleAdded = await Discord.addDiscordAccountOwnerRole(discordId);
        Discord.sendDiscordDirectMessage("Thanks for linking your Discord account to Mineskin! :)", discordId);
        Discord.postDiscordMessage("👤 Discord " + discordUsername + " <@" + discordId + "> linked to account #" + account.id + "/" + account.uuid);
        return roleAdded;
    }

}

function validateSessionAndToken(req: AccountManagerRequest, res: Response): boolean {
    if (!req.headers.authorization || !req.headers.authorization.startsWith("Bearer ")) {
        res.status(400).json({ error: "invalid session (bearer)" });
        return false;
    }
    const headerToken = req.headers.authorization.replace("Bearer ", "");
    if (!req.session || !req.session.account) {
        res.status(400).json({ error: "invalid session (account)" });
        return false;
    }
    if (headerToken !== req.session.account.token) {
        res.status(400).json({ error: "invalid session (token)" });
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

async function getAndValidateMojangProfile(accessToken: string, uuid: string): Promise<MojangProfileValidation> {
    if (!uuid || uuid.length < 32 || !accessToken) return { valid: false };
    const shortUuid = stripUuid(uuid);
    const profile = await Caching.getProfileByAccessToken(accessToken);
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

    gamePass?: boolean;
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



