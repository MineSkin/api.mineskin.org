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

export const register = (app: Application, config: MineSkinConfig) => {

    const jwtPrivateKey = fs.readFileSync(config.jwt.keys.private);
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
        console.log(req.cookies);
        console.log(req.body)

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
                sessions: {},
                minecraftAccounts: <string[]>[]
            }).save();
            console.log(info(`Created new user account for ${ user.email } ${ getIp(req) }`));
        }

        const tokenId = randomUuid();
        if (!user.sessions) {
            user.sessions = {};
        }
        user.sessions[tokenId] = new Date();
        user.markModified('sessions');
        //TODO: expire old sessions

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
        res.cookie("mineskin_account", token, {
            domain: '.mineskin.org', //TODO: url
            secure: true,
            httpOnly: true,
            // signed: true,
            maxAge: Time.hours(1)
        })

        console.log(debug(`Created new session for ${ user.uuid }/${ user.email } ${ getIp(req) }`));

        res.redirect('https://mineskin.org/account');
    })

    app.get("/account", async (req, res) => {
        const user = await validateAuth(req, res);
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
        const user = await validateAuth(req, res);
        if (!user) {
            return;
        }
        let accountIds = user.minecraftAccounts || [];
        if (accountIds.length === 0) {
            res.json([]);
            return;
        }
        let accounts = await Account.find({
            user: user.uuid,
            uuid: { $in: accountIds }
        }, 'uuid email playername accountType enabled').exec();
        res.json(accounts);
    })

    app.get("/account/apiKeys", async (req, res) => {
        const user = await validateAuth(req, res);
        if (!user) {
            return;
        }
        let keys = await ApiKey.find({
            user: user.uuid
        }, 'name').exec();
        res.json(keys);
    })


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
            jwt.verify(token, jwtPrivateKey, options, (err, jwt) => {
                if (err || !jwt) {
                    reject(err);
                    return;
                }
                resolve(jwt as Jwt);
            })
        })
    }

    async function validateAuth(req: Request, res: Response): Promise<IUserDocument | undefined> {
        const cookie = req.cookies['mineskin_account'];
        console.log(cookie);
        if (!cookie || cookie.length <= 0) {
            res.status(400).json({ error: 'invalid auth (1)' })
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
                res.status(400).json({ error: 'invalid auth (2)' })
            }
            return;
        }
        console.log(jwt);
        const payload = jwt.payload as JwtPayload;
        if (!jwt || !payload) {
            res.status(400).json({ error: 'invalid auth (3)' })
            return;
        }
        if (!payload['sub'] || !payload['gid'] || !payload['email'] || !payload['jti']) {
            res.status(400).json({ error: 'invalid auth (4)' })
            return;
        }

        const user = await User.findForIdGoogleIdAndEmail(payload['sub'], payload['gid'], payload['email']);
        if (!user) {
            res.status(400).json({ error: 'user not found' });
            return;
        }

        if (!user.sessions) {
            // has no sessions
            res.status(400).json({ error: 'invalid session (1)' })
            return;
        }
        const sessionId = payload['jti']!;
        const sessionDate = user.sessions[sessionId];
        if (!sessionDate) {
            // invalid/expired session
            res.status(400).json({ error: 'invalid session (2)' })
            return;
        }
        if (Date.now() - sessionDate.getTime() > Time.hours(1)) {
            // expired session
            res.status(400).json({ error: 'session expired' });
            delete user.sessions[sessionId];
            user.markModified('sessions');
            await user.save();
            return;
        }

        user.lastUsed = new Date();

        return await user.save();
    }

};
