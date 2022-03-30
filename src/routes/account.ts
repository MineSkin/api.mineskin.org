import { Application } from "express";
import { MineSkinConfig } from "../typings/Configs";
import { corsWithCredentialsMiddleware, getIp } from "../util";
import jwt from "jsonwebtoken";
import { LoginTicket, OAuth2Client } from "google-auth-library";
import { v4 as randomUuid } from "uuid";
import * as fs from "fs";
import { Caching } from "../generator/Caching";

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

    app.get("/account/google/frame", async (req, res) => {
        const nonce = randomUuid().replace(/-/g, '');
        Caching.putLoginNonce(getIp(req), nonce);
        res.send(`
                <div class="g_id_signin"
                     data-server="${ config.server }"
                     data-nonce="${ nonce }"
                     data-locale="en"
                     data-logo_alignment="left"
                     data-shape="pill"
                     data-size="large"
                     data-text="continue_with"
                     data-theme="filled_blue"
                     data-type="standard">
                </div>
                <div data-auto_select="true"
                     data-client_id="352641379376-54jd29mpaorrk7bdvqh4qlll4a4n5g2b.apps.googleusercontent.com"
                     data-context="use"
                     data-login_uri="https://${ config.server }.api.mineskin.org/account/google/callback"
                     data-todo="url" data-ux_mode="popup"
                     id="g_id_onload">
                </div>
                <script async defer src="https://accounts.google.com/gsi/client"></script>
        `)
    })

    app.post("/account/google/callback", async (req, res) => {
        console.log(req.cookies);
        console.log(req.body)

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
