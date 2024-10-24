import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { Log } from "../Log";

export const mineskinUserMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    await handleUser(req, res);
    next();
}

export  const handleUser = async (req: MineSkinV2Request, res: Response) => {
    const user = await req.client.getUser();
    if (!user) {
        return;
    }

    Log.l.debug(`${ req.breadcrumbC } User:       ${ user.uuid }`);
}