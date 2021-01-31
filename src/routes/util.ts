import { Application } from "express";
import { Caching } from "../generator/Caching";
import { Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { Generator } from "../generator/Generator";
import { corsMiddleware } from "../util";

export const register = (app: Application) => {

    app.use("/validate", corsMiddleware);

    app.get("/validate/name/:name", (req: Request, res: Response) => {
        if (req.params["name"].length < 1 || req.params["name"].length > 16) {
            res.status(400).json({ error: "invalid name" });
            return;
        }
        Caching.getUserByName(req.params["name"]).then(user => {
            if (!user || !user.valid) {
                res.status(404);
            }
            res.json(user);
        }).catch(err => {
            Sentry.captureException(err);
            res.status(404).json({ error: "failed to get user" });
        })
    });

    //TODO: remove
    app.get("/validate/user/:name", (req: Request, res: Response) => {
        if (req.params["name"].length < 1 || req.params["name"].length > 16) {
            res.status(400).json({ error: "invalid name" });
            return;
        }
        Caching.getUserByName(req.params["name"]).then(user => {
            if (!user || !user.valid) {
                res.status(404);
            }
            res.json(user);
        }).catch(err => {
            Sentry.captureException(err);
            res.status(404).json({ error: "failed to get user" });
        })
    });

    app.get("/validate/uuid/:uuid", (req: Request, res: Response) => {
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

    //TODO: remove
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

};
