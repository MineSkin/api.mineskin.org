import { Application, Request, Response } from "express";
import { MineSkinConfig } from "../typings/Configs";
import { corsWithCredentialsMiddleware, getIp, Maybe, stripUuid } from "../util";
import jwt, { JsonWebTokenError, Jwt, JwtPayload, SignOptions, VerifyOptions } from "jsonwebtoken";
import { LoginTicket, OAuth2Client } from "google-auth-library";
import { v4 as randomUuid } from "uuid";
import * as fs from "fs";
import { Caching } from "../generator/Caching";
import { Account, User } from "../database/schemas"
import { IUserDocument } from "../typings/db/IUserDocument";
import { debug, info } from "../util/colors";
import { Time } from "@inventivetalent/time";
import { ApiKey } from "../database/schemas/ApiKey";
import { Discord } from "../util/Discord";

let jwtPrivateKey: Buffer;

export const register = (app: Application, config: MineSkinConfig) => {

    jwtPrivateKey = fs.readFileSync(config.jwt.keys.private);
    const googleClient = new OAuth2Client(config.google.id, config.google.secret);

    app.use("/account", corsWithCredentialsMiddleware);
    // app.use("/account", session({
    //     secret: config.sessionSecret,
    //     resave: false,
    //     saveUninitialized: true,
    //     cookie: {
    //         maxAge: Time.minutes(30),
    //         domain: "api.mineskin.org"
    //     }
    // }))

    app.post("/account/google/init", async (req, res) => {
        const nonce = stripUuid(randomUuid());
        Caching.putLoginNonce(getIp(req), nonce);
        //TODO client id, maybe
        res.json({
            login_uri: `https://${ config.server }.api.mineskin.org/account/google/callback`,
            nonce: nonce
        });
    })

    app.post("/account/google/callback", async (req, res) => {
        //TODO: enable this on prod, doesn't seem to add the cookie on the testing subdomain
        /*
        const csrfCookie = req.cookies['g_csrf_token'];
        if (!csrfCookie || csrfCookie.length <= 0) {
            res.status(400);
            return;
        }
        const csrfBody = req.body['g_csrf_token'];
        if (!csrfBody || csrfCookie.length <= 0) {
            res.status(400);
            return;
        }
        if (csrfCookie !== csrfBody) {
            res.status(400);
            return;
        }
         */

        let ticket: LoginTicket;
        try {
            ticket = await googleClient.verifyIdToken({
                idToken: req.body['credential'],
                audience: config.google.id
            });
        } catch (e) {
            console.warn(e);
            res.status(400);
            return;
        }

        const payload = ticket.getPayload();
        console.log(payload)
        if (!payload) {
            return;
        }
        const userId = payload['sub'];
        const email = payload['email']!;


        let user: Maybe<IUserDocument> = await User.findForGoogleIdAndEmail(userId, email);
        if (!user) {
            // create new user
            user = await new User(<IUserDocument>{
                uuid: stripUuid(randomUuid()),
                googleId: userId,
                email: email,
                created: new Date(),
                lastUsed: new Date(),
                sessions: {}
            }).save();
            console.log(info(`Created new user account for ${ user.email } ${ getIp(req) }`));
            Discord.postDiscordMessage(`👤 [${ config.server }] Created new user account for ${ user.email }`);
        }

        const tokenId = randomUuid();
        if (!user.sessions) {
            user.sessions = {};
        }
        user.sessions[tokenId] = new Date();
        let expiredIds = [];
        for (let k in user.sessions) {
            if (Date.now() - user.sessions[k].getTime() > Time.hours(1)) {
                expiredIds.push(k);
            }
        }
        for (let k of expiredIds) {
            delete user.sessions[k];
        }
        user.markModified('sessions');

        user.lastUsed = new Date();
        await user.save();

        //TODO: should probably have a nonce

        const token = await sign({
            sub: user.uuid,
            gid: userId,
            email: email
        }, {
            algorithm: 'HS512',
            issuer: 'https://api.mineskin.org',
            jwtid: tokenId,
            expiresIn: '1h'
        });
        res.cookie('access_token', token, {
            domain: '.mineskin.org',
            secure: true,
            httpOnly: true,
            maxAge: Time.hours(1)
        })

        console.log(debug(`Created new session for ${ user.uuid }/${ user.email } ${ getIp(req) }`));

        res.end();
    })

    app.get("/account/logout", async (req, res) => {
        const user = await getUserFromRequest(req, res);
        if (user && user.session) {
            delete user.sessions[user.session];
            user.markModified('sessions');
            await user.save();
        }

        res.clearCookie('access_token');

        res.end();
    })

    app.get("/account", async (req, res) => {
        const user = await getUserFromRequest(req, res);
        if (!user) {
            return;
        }
        res.json({
            uuid: user.uuid,
            email: user.email,
            created: user.created,
            lastUsed: user.lastUsed,
            sessions: user.sessions.length
        });
    })

    app.get("/account/minecraftAccounts", async (req, res) => {
        const user = await getUserFromRequest(req, res);
        if (!user) {
            return;
        }
        let docs = await Account.find({
            user: user.uuid
        }, 'uuid email playername accountType enabled errorCounter').lean().exec();
        let accounts = [];
        for (let doc of docs) {
            accounts.push({
                uuid: doc.uuid,
                email: doc.email,
                playername: doc.playername,
                accountType: doc.accountType,
                enabled: doc.enabled,
                hasErrors: doc.errorCounter > 0
            })
        }
        res.json(accounts);
    })

    app.get("/account/apiKeys", async (req, res) => {
        const user = await getUserFromRequest(req, res);
        if (!user) {
            return;
        }
        let docs = await ApiKey.find({
            user: user.uuid
        }, 'name lastUsed').lean().exec();
        let keys = [];
        for (let doc of docs) {
            keys.push({
                name: doc.name,
                lastUsed: doc.lastUsed
            })
        }
        res.json(keys);
    })

    app.get("/account/skins", async (req, res) => {
        const user = await getUserFromRequest(req, res);
        if (!user) {
            return;
        }
        let skins = user.skins || [];
        res.json(skins);
    });


    //// DISCORD LINKING TODO

    /*
    app.get("/account/discord/oauth/start", async (req: Request, res: Response) => {
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
        const redirect = encodeURIComponent(`https://${ config.server }.api.mineskin.org/accountManager/discord/oauth/callback`);
        const state = sha256(`${ account.getAccountType() }${ account.uuid }${ Math.random() }${ req.session.account.email! }${ Date.now() }${ account.id }`);

        Caching.storePendingDiscordLink(<PendingDiscordAccountLink>{
            state: state,
            account: account.id,
            uuid: account.uuid,
            email: req.session.account.email!
        });

        res.redirect(`https://discordapp.com/api/oauth2/authorize?client_id=${ clientId }&scope=identify&response_type=code&state=${ state }&redirect_uri=${ redirect }`);
    })

    app.get("/account/discord/oauth/callback", async (req: Request, res: Response) => {
        if (!req.query["code"] || !req.query["state"]) {
            res.status(400).end();
            return;
        }
        const config = await getConfig();
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
        const profileValidation = await getAndValidateMojangProfile(req.session.account.token!, pendingLink.uuid);
        if (!profileValidation.valid || !profileValidation.profile) return;

        const clientId = config.discordAccount.id;
        const clientSecret = config.discordAccount.secret;
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

        if (account.discordUser) {
            console.warn(warn("Account #" + account.id + " already has a linked discord user (#" + account.discordUser + "), changing to " + discordId));
        }
        account.discordUser = discordId;
        await account.save();

        console.log(info("Discord User " + userBody["username"] + "#" + userBody["discriminator"] + " linked to Mineskin account #" + account.id + "/" + account.uuid + " - adding roles!"));
        const roleAdded = await Discord.addDiscordAccountOwnerRole(discordId);
        Discord.sendDiscordDirectMessage("Thanks for linking your Discord account to Mineskin! :)", discordId);
        Discord.postDiscordMessage("👤 " + userBody.username + "#" + userBody.discriminator + " <@" + discordId + "> linked to account #" + account.id + "/" + account.uuid);
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
    */

};


function sign(payload: string | Buffer | object, options: SignOptions): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        jwt.sign(payload, jwtPrivateKey, options, (err, token) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(token);
        })
    })
}

function verify(token: string, options: VerifyOptions): Promise<Jwt> {
    return new Promise((resolve, reject) => {
        options.complete = true;
        try {
            jwt.verify(token, jwtPrivateKey, options, (err, jwt) => {
                if (err || !jwt) {
                    reject(err);
                    return;
                }
                resolve(jwt as Jwt);
            })
        } catch (e) {
            console.warn(e);
            reject(e);
        }
    })
}

export async function getUserFromRequest(req: Request, res: Response, reject: boolean = true): Promise<IUserDocument & { session?: string; } | undefined> {
    const cookie = req.cookies['access_token'];
    if (!cookie || cookie.length <= 0) {
        if (reject) res.status(401).json({ error: 'invalid auth (1)' })
        return;
    }

    if (!req.headers.origin || (!req.headers.origin.startsWith('https://mineskin.org') && !req.headers.origin.startsWith('https://testing.mineskin.org'))) { //TODO
        if (reject) res.status(400).json({ error: 'origin not allowed' });
        return;
    }

    let jwt;
    try {
        jwt = await verify(cookie, {
            algorithms: ['HS512'],
            issuer: ['https://api.mineskin.org'],
            maxAge: '1h'
        });
    } catch (e) {
        console.warn(e);
        if (e instanceof JsonWebTokenError) {
            if (reject) res.status(401).json({ error: 'invalid auth (2)' })
        }
        return;
    }
    const payload = jwt.payload as JwtPayload;
    if (!jwt || !payload) {
        if (reject) res.status(401).json({ error: 'invalid auth (3)' })
        return;
    }
    if (!payload['sub'] || !payload['gid'] || !payload['email'] || !payload['jti']) {
        if (reject) res.status(401).json({ error: 'invalid auth (4)' })
        return;
    }

    const user = await User.findForIdGoogleIdAndEmail(payload['sub'], payload['gid'], payload['email']);
    if (!user) {
        if (reject) res.status(401).json({ error: 'user not found' });
        return;
    }

    if (!user.sessions) {
        // has no sessions
        if (reject) res.status(401).json({ error: 'invalid session (1)' })
        return;
    }
    const sessionId = payload['jti']!;
    const sessionDate = user.sessions[sessionId];
    if (!sessionDate) {
        // invalid/expired session
        if (reject) res.status(401).json({ error: 'invalid session (2)' })
        return;
    }
    if (Date.now() - sessionDate.getTime() > Time.hours(1)) {
        // expired session
        if (reject) res.status(401).json({ error: 'session expired' });
        delete user.sessions[sessionId];
        user.markModified('sessions');
        await user.save();
        return;
    }

    user.lastUsed = new Date();

    const u: IUserDocument & { session?: string; } = await user.save();
    u.session = sessionId;
    return u;
}
