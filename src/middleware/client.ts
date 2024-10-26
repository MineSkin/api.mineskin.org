import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { getIp, getVia, simplifyUserAgent } from "../util";
import * as Sentry from "@sentry/node";
import { RequestClient } from "@mineskin/generator";
import { Log } from "../Log";

export const clientMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    initRequestClient(req, res);
    next();
}

export const initRequestClient = (req: MineSkinV2Request, res: Response) => {
    const rawUserAgent = req.header("user-agent") || "n/a";
    const origin = req.header("origin");
    const ip = getIp(req);
    const via = getVia(req);

    Sentry.setTags({
        "generate_via": via
    });

    const userAgent = simplifyUserAgent(rawUserAgent);
    if (userAgent.generic) {
        req.warnings.push({
            code: "generic_user_agent",
            message: "User agent is generic. Please use a more specific user agent."
        })
    }

    Log.l.debug(`${ req.breadcrumbC } Agent:       ${ req.headers["user-agent"] }`);
    if (req.headers['origin']) {
        Log.l.debug(`${ req.breadcrumbC } Origin:      ${ req.headers['origin'] }`);
    }

    if (!res.hasHeader("MineSkin-Api-Version")) {
        res.header("MineSkin-Api-Version", "v2");
    }

    req.client = new RequestClient(Date.now(), userAgent.ua, origin, ip, via);
}

export const clientFinalMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    await finalizeRequestClient(req, res);
    next();
}

export const finalizeRequestClient = async (req: MineSkinV2Request, res: Response) => {
    req.clientInfo = await req.client.asClientInfo(req);
}

