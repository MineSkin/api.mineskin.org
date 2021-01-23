import { Application } from "express";
import { Caching } from "../generator/Caching";
import { Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { Generator } from "../generator/Generator";

export const register = (app: Application) => {

    app.get("/validate/user/:path", (req: Request, res: Response) => {
        if (req.params["path"].length < 1 || req.params["path"].length > 16) {
            res.status(400).json({ error: "invalid path" });
            return;
        }
        Caching.getUserByName(req.params["path"]).then(user => {
            if (!user || !user.valid) {
                res.status(404);
            }
            res.json(user);
        }).catch(err => {
            Sentry.captureException(err);
            res.status(404).json({ error: "failed to get user" });
        })
    });

    app.get("/validate/currentUsername/:uuid", (req: Request, res: Response) => {
        if (req.params["uuid"].length < 32) {
            res.status(400).json({ error: "invalid uuid" });
            return;
        }
        Caching.getUserByUuid(req.params["uuid"]).then(user => {
            if (!user || !user.valid) {
                res.status(404);
            }
            res.json(user);
        }).catch(err => {
            Sentry.captureException(err);
            res.status(404).json({ error: "failed to get user" });
        })
    });

    app.get("/preferredAccountServer", (req: Request, res: Response) => {
        Generator.getPreferredAccountServer().then(server => {
            res.json({ preferredServer: server });
        }).catch(err => {
            Sentry.captureException(err);
            res.status(404).json({ error: "failed to get server" });
        })
    })

};
