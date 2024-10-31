import { Application, Request, Response } from "express";
import { Caching } from "../generator/Caching";
import * as Sentry from "@sentry/node";
import { corsMiddleware } from "../util";
import { randomPNG } from "random-png";
import { validateLimiter } from "../util/rateLimiters";
import { adjectives, animals, colors, uniqueNamesGenerator } from 'unique-names-generator';

export const register = (app: Application) => {

    app.use("/validate", corsMiddleware);
    app.use("/validate", validateLimiter);

    app.get("/validate/name/:name", (req: Request, res: Response) => {
        if (req.params["name"].length < 1 || req.params["name"].length > 16) {
            res.status(400).json({error: "invalid name"});
            return;
        }
        res.header("Cache-Control", "public, max-age=3600");
        Caching.getUserByName(req.params["name"]).then(user => {
            if (!user || !user.valid) {
                res.status(404);
            }
            res.json(user);
        }).catch(err => {
            Sentry.captureException(err);
            res.status(404).json({error: "failed to get user"});
        })
    });

    //TODO: remove
    app.get("/validate/user/:name", (req: Request, res: Response) => {
        if (req.params["name"].length < 1 || req.params["name"].length > 16) {
            res.status(400).json({error: "invalid name"});
            return;
        }
        Caching.getUserByName(req.params["name"]).then(user => {
            if (!user || !user.valid) {
                res.status(404);
            }
            res.json(user);
        }).catch(err => {
            Sentry.captureException(err);
            res.status(404).json({error: "failed to get user"});
        })
    });

    app.get("/validate/uuid/:uuid", (req: Request, res: Response) => {
        if (req.params["uuid"].length < 32) {
            res.status(400).json({error: "invalid uuid"});
            return;
        }
        res.header("Cache-Control", "public, max-age=3600");
        Caching.getUserByUuid(req.params["uuid"]).then(user => {
            if (!user || !user.valid) {
                res.status(404);
            }
            res.json(user);
        }).catch(err => {
            Sentry.captureException(err);
            res.status(404).json({error: "failed to get user"});
        })
    });

    //TODO: remove
    app.get("/validate/currentUsername/:uuid", (req: Request, res: Response) => {
        if (req.params["uuid"].length < 32) {
            res.status(400).json({error: "invalid uuid"});
            return;
        }
        Caching.getUserByUuid(req.params["uuid"]).then(user => {
            if (!user || !user.valid) {
                res.status(404);
            }
            res.json(user);
        }).catch(err => {
            Sentry.captureException(err);
            res.status(404).json({error: "failed to get user"});
        })
    });

    app.get("/random-image", (req: Request, res: Response) => {
        const buffer = randomPNG(64, 64);
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': buffer.length,
            'Content-Disposition': `inline; filename="random${ Math.round(Math.random() * 1000) }.png"`
        });
        res.end(buffer);
    });

    app.use("/random-name", corsMiddleware);

    app.get("/random-name", (req: Request, res: Response) => {
        const seed = req.query.seed as string || `${ Math.random() }`;
        const name = uniqueNamesGenerator({
            dictionaries: [adjectives, colors, animals],
            separator: ' ',
            style: 'capital',
            seed: seed
        });
        res.header("Cache-Control", "public, max-age=3600");
        res.json({name});
    });

};
