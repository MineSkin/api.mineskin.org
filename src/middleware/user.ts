import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { Log } from "@mineskin/generator";

export const mineskinUserMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    const user = await req.client.getUser();
    if (!user) {
        return next();
    }

    Log.l.debug(`${ req.breadcrumbC } User:       ${ user.uuid }`);

    next();
}