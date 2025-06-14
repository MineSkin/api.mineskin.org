import { applyBreadcrumb } from "./breadcrumb";
import { NextFunction, Response } from "express";
import { MineSkinV2Request } from "../routes/v2/types";
import { finalizeRequestClient, initRequestClient } from "./client";
import { verifyApiKey } from "./apikey";
import { verifyJwtCookie } from "./jwt";
import { handleUser } from "./user";
import { verifyGrants } from "./grants";

export const mineSkinV2InitialMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    applyBreadcrumb(req, res);
    initRequestClient(req, res);
    await verifyApiKey(req, res);
    await verifyJwtCookie(req, res);
    await handleUser(req, res);
    // await verifyCredits(req, res);
    await verifyGrants(req, res);
    await finalizeRequestClient(req, res);
    next();
}