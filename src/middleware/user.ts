import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { Log } from "@mineskin/generator";
import { User } from "@mineskin/database";

export const mineskinUserMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    if (!req.client?.user) {
        return next();
    }

    const user = await User.findByUUID(req.client.user);
    if (!user) {
        return next();
    }

    if (!req.grants) {
        req.grants = {};
    }

    Log.l.debug(`${ req.breadcrumbC } User:       ${ user.uuid }`);

    req.user = {
        uuid: user.uuid,
        billable: user.billable,
        grants: user.grants
    }

    if (user.grants) {
        req.grants = {...req.grants, ...user.grants};
    }

    next();
}