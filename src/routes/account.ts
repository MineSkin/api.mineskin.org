import { Application, Request, Response } from "express";
import { getConfig, MineSkinConfig } from "../typings/Configs";
import { corsWithCredentialsMiddleware, getIp, Maybe, sha256, stripUuid } from "../util";
import jwt, { JsonWebTokenError, Jwt, JwtPayload, SignOptions, VerifyOptions } from "jsonwebtoken";
import { LoginTicket, OAuth2Client } from "google-auth-library";
import { v4 as randomUuid } from "uuid";
import { Caching } from "../generator/Caching";
import { Account, User } from "../database/schemas"
import { IUserDocument } from "../typings/db/IUserDocument";
import { debug, info, warn } from "../util/colors";
import { Time } from "@inventivetalent/time";
import { ApiKey } from "../database/schemas/ApiKey";
import { Discord } from "../util/Discord";
import { PendingDiscordAccountLink } from "../typings/DiscordAccountLink";
import { Requests } from "../generator/Requests";
import qs from "querystring";
import { redisClient } from "../database/redis";

export const register = (app: Application, config: MineSkinConfig) => {

    const googleClient = new OAuth2Client(config.google.id, config.google.secret);

    app.use("/account", corsWithCredentialsMiddleware);

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
            discordLinked: !!user.discordId,
            sessions: user.sessions.length,
            sessionTimeout: Math.floor(((user.sessions[user.session!].getTime() + Time.hours(1)) - Date.now()) / 1000)
        });
    });

    app.delete('/account', async (req, res) => {
        const user = await getUserFromRequest(req, res);
        if (!user) {
            return;
        }
        if (req.query['confirm'] !== 'true') {
            res.status(400).json({
                error: 'not confirmed'
            });
            return;
        }

        res.clearCookie('access_token');

        await user.deleteOne();

        console.log(info(`Deleted user account for ${ user.email } ${ getIp(req) }`));

        res.json({
            msg: 'account removed'
        });
    })

    app.get("/account/minecraftAccounts", async (req, res) => {
        const user = await getUserFromRequest(req, res);
        if (!user) {
            return;
        }
        let docs = await Account.find({
            user: user.uuid
        }, 'uuid email playername accountType enabled errorCounter successCounter').lean().exec();
        let accounts = [];
        for (let doc of docs) {
            accounts.push({
                uuid: doc.uuid,
                email: doc.email,
                playername: doc.playername,
                accountType: doc.accountType,
                enabled: doc.enabled,
                hasErrors: doc.errorCounter > 0,
                successCount: Math.round(doc.successCounter / 100) * 100,
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
        }, '_id name lastUsed').lean().exec();
        let keys = [];
        for (let doc of docs) {
            const keyId = doc._id;
            const date = new Date();

            const yearNew = await redisClient?.get(`mineskin:generated:apikey:${ keyId }:${ date.getFullYear() }:new`);
            const monthNew = await redisClient?.get(`mineskin:generated:apikey:${ keyId }:${ date.getFullYear() }:${ date.getMonth() + 1 }:new`);

            keys.push({
                id: ("" + doc._id),
                name: doc.name,
                lastUsed: doc.lastUsed,
                usage: {
                    new: {
                        year: yearNew || 0,
                        month: monthNew || 0
                    }
                }
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


    //// DISCORD LINKING

    app.get("/account/discord/oauth/start", async (req: Request, res: Response) => {
        const config = await getConfig();
        if (!config.discordAccount) {
            res.status(400).json({error: "server can't handle discord auth"});
            return;
        }
        const user = await getUserFromRequest(req, res);
        if (!user) {
            return;
        }

        const clientId = config.discordAccount.id;
        const redirect = encodeURIComponent(`https://api.mineskin.org/account/discord/oauth/callback`);
        const state = config.server + '_' + sha256(`${ user.uuid }${ Math.random() }${ user.email }${ Date.now() }${ Math.random() }`);

        Caching.storePendingDiscordLink(<PendingDiscordAccountLink>{
            state: state,
            user: user.uuid,
            email: user.email
        });

        res.redirect(`https://discordapp.com/api/oauth2/authorize?client_id=${ clientId }&scope=identify&response_type=code&state=${ state }&redirect_uri=${ redirect }`);
    })

    app.get("/account/discord/oauth/callback", async (req: Request, res: Response) => {
        if (!req.query["code"] || !req.query["state"]) {
            res.status(400).end();
            return;
        }
        const config = await getConfig();
        let stateSplit = (req.query['state'] as string).split('_');
        if (config.server != stateSplit[0]) {
            // redirect to correct server
            res.redirect(`https://${ stateSplit[0] }.api.mineskin.org/account/discord/oauth/callback?code=${ req.query['code'] }&state=${ req.query['state'] }`);
            return;
        }
        if (!config.discordAccount) {
            res.status(400).json({error: "server can't handle discord auth"});
            return;
        }

        const pendingLink: Maybe<PendingDiscordAccountLink> = Caching.getPendingDiscordLink(req.query["state"] as string);
        if (!pendingLink) {
            console.warn("Got a discord OAuth callback but the API wasn't expecting that linking request");
            res.status(400).json({error: "invalid state"});
            return;
        }
        Caching.invalidatePendingDiscordLink(req.query["state"] as string);

        const user = await getUserFromRequest(req, res);
        if (!user) {
            return;
        }
        if (user.uuid !== pendingLink.user || user.email !== pendingLink.email) {
            res.status(401).json({error: 'invalid state'});
            return;
        }

        const clientId = config.discordAccount.id;
        const clientSecret = config.discordAccount.secret;
        const redirect = `https://api.mineskin.org/account/discord/oauth/callback`;

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
            res.status(500).json({error: "Discord API error"});
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

        const discordId = userBody['id'];
        if (!discordId) {
            console.warn("Discord response did not have an id field")
            res.status(404).json({error: "Discord API error"});
            return;
        }


        if (user.discordId) {
            console.warn(warn("User Account " + user.uuid + " already has a linked discord user (#" + user.discordId + "), changing to " + discordId));
        }
        user.discordId = discordId;
        await user.save();

        console.log(info("Discord User " + userBody["username"] + "#" + userBody["discriminator"] + " linked to Mineskin user " + user.uuid + "/" + user.email + " - adding roles!"));
        const roleAdded = await Discord.addDiscordUserRole(discordId);
        // Discord.sendDiscordDirectMessage("Thanks for linking your Discord account to Mineskin! :)", discordId);
        Discord.postDiscordMessage("👤 " + userBody.username + "#" + userBody.discriminator + " <@" + discordId + "> linked to user " + user.uuid + "/" + user.email);
        res.json({
            success: true,
            msg: "Successfully linked your Discord account to Mineskin, yay! You can close this window now :)"
        });
    })

};


function sign(payload: string | Buffer | object, options: SignOptions): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        jwt.sign(payload, process.env.JWT_PRIVATE_KEY_ACCOUNT as string, options, (err, token) => {
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
            jwt.verify(token, process.env.JWT_PRIVATE_KEY_ACCOUNT as string, options, (err, jwt) => {
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

export async function getUserFromRequest(req: Request, res: Response, reject: boolean = true): Promise<IUserDocument & {
    session?: string;
} | undefined> {
    const cookie = req.cookies['access_token'];
    if (!cookie || cookie.length <= 0) {
        if (reject) res.status(401).json({error: 'invalid auth (1)'})
        return;
    }


    // if (!req.headers.origin) {
    //     if (reject) res.status(400).json({ error: 'origin not allowed' });
    //     return;
    // }
    if (!!req.headers.origin) {
        let originAllowed = req.headers.origin.startsWith('https://mineskin.org') ||
            req.headers.origin.startsWith('https://www.mineskin.org') ||
            req.headers.origin.startsWith('https://testing.mineskin.org');
        if (!originAllowed) {
            if (reject) res.status(400).json({error: 'origin not allowed'});
            return;
        }
    }

    let jwt;
    try {
        jwt = await verify(cookie, {
            algorithms: ['HS512'],
            issuer: ['https://api.mineskin.org'],
            maxAge: '1h'
        });
    } catch (e) {
        console.warn("Failed to verify JWT", e);
        console.log(getIp(req))
        console.log(cookie);
        if (e instanceof JsonWebTokenError) {
            if (reject) res.status(401).json({error: 'invalid auth (2)'})
        }
        return;
    }
    const payload = jwt.payload as JwtPayload;
    if (!jwt || !payload) {
        if (reject) res.status(401).json({error: 'invalid auth (3)'})
        return;
    }
    if (!payload['sub'] || !payload['gid'] || !payload['email'] || !payload['jti']) {
        if (reject) res.status(401).json({error: 'invalid auth (4)'})
        return;
    }

    const user = await User.findForIdGoogleIdAndEmail(payload['sub'], payload['gid'], payload['email']);
    if (!user) {
        if (reject) res.status(401).json({error: 'user not found'});
        return;
    }

    if (!user.sessions) {
        // has no sessions
        if (reject) res.status(401).json({error: 'invalid session (1)'})
        return;
    }
    const sessionId = payload['jti']!;
    const sessionDate = user.sessions[sessionId];
    if (!sessionDate) {
        // invalid/expired session
        if (reject) res.status(401).json({error: 'invalid session (2)'})
        return;
    }
    if (Date.now() - sessionDate.getTime() > Time.hours(1)) {
        // expired session
        if (reject) res.status(401).json({error: 'session expired'});
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
