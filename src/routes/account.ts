import { Application } from "express";
import { MineSkinConfig } from "../typings/Configs";
import { corsWithCredentialsMiddleware } from "../util";
import session from "express-session";
import { Time } from "@inventivetalent/time";

export const register = (app: Application, config: MineSkinConfig) => {

    app.use("/account", corsWithCredentialsMiddleware);
    app.use("/account", session({
        secret: config.sessionSecret,
        resave: false,
        saveUninitialized: true,
        cookie: {
            maxAge: Time.minutes(30),
            domain: "api.mineskin.org"
        }
    }))

};
