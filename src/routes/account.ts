import { Application } from "express";
import { MineSkinConfig } from "../typings/Configs";
import { corsWithCredentialsMiddleware } from "../util";
import jwt from "jsonwebtoken";
import { LoginTicket, OAuth2Client } from "google-auth-library";
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

        let ticket: LoginTicket;
        try{
            ticket = await googleClient.verifyIdToken({
                idToken: req.body['credential'],
                audience: config.google.id
            });
        }catch (e ){
            console.warn(e);
            res.status(400);
            return;
        }

        const payload = ticket.getPayload();
        if (!payload) {
            return;
        }
        const userId = payload['sub'];

        console.log(payload)

        //TODO: should probably have a nonce

        const token = jwt.sign({
            test: "hi"
        }, jwtPrivateKey, {
            issuer: "https://api.mineskin.org"
        });
        res.cookie("mineskin_account", token, {
            domain: 'mineskin.org',
            secure: true,
            httpOnly: true
        })
    })

};
