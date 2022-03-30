import { Application } from "express";
import { MineSkinConfig } from "../typings/Configs";
import { corsWithCredentialsMiddleware } from "../util";
import jwt from "jsonwebtoken";
import { LoginTicket, OAuth2Client } from "google-auth-library";
import { v4 as randomUuid } from "uuid";
import * as fs from "fs";

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
        const email = payload['email'];

        const user = randomUuid(); //TODO
        const tokenId = randomUuid();

        //TODO: should probably have a nonce

        const token = jwt.sign({
            sub: user,
            email: email,
            act: {
                sub: userId
            }
        }, jwtPrivateKey, {
            algorithm: 'HS512',
            issuer: "https://api.mineskin.org",
            jwtid: tokenId,
            expiresIn: '1h'
        });
        res.cookie("mineskin_account", token, {
            domain: 'mineskin.org',
            secure: true,
            httpOnly: true,
            signed: true
        })

        res.redirect('https://mineskin.org/account');
    })

};
