import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { Log } from "../Log";
import * as Sentry from "@sentry/node";

export const mineskinUserMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    await handleUser(req, res);
    next();
}

export const handleUser = async (req: MineSkinV2Request, res: Response) => {
    return await Sentry.startSpan({
        op: 'middleware',
        name: 'handleUser'
    }, async span => {
        const user = await req.client.getUser();
        if (!user) {
            return;
        }

        Log.l.debug(`${ req.breadcrumbC } User:       ${ user.uuid }`);
    })
}