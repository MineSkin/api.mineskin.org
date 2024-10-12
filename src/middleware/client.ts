import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { getIp, getVia, simplifyUserAgent } from "../util";
import * as Sentry from "@sentry/node";
import { Log } from "@mineskin/generator";
import { RequestClient } from "../typings/v2/RequestClient";

export const clientMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
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

    Log.l.debug(`${ req.breadcrumbC } Agent:       ${ req.headers["user-agent"] }`, {
        breadcrumb: req.breadcrumb,
        userAgent: req.headers["user-agent"]
    });
    if (req.headers['origin']) {
        Log.l.debug(`${ req.breadcrumbC } Origin:      ${ req.headers['origin'] }`, {
            breadcrumb: req.breadcrumb,
            origin: req.headers['origin']
        });
    }

    res.header("X-MineSkin-Api-Version", "v2");

    req.client = new RequestClient(Date.now(), userAgent, origin, ip, via);
    next();
}

export const clientFinalMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    req.clientInfo = req.client.asClientInfo(req);
    next();
}
