import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { getIp, getVia, simplifyUserAgent } from "../util";
import * as Sentry from "@sentry/node";
import { logger } from "../util/log";
import { debug } from "../util/colors";
import { ClientInfo } from "@mineskin/types";

export const mineskinClientMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    const rawUserAgent = req.header("user-agent") || "n/a";
    const origin = req.header("origin");
    const ip = getIp(req);
    const via = getVia(req);

    let billable = false;
    if (req.apiKey) {
        billable = req.apiKey.billable || false;
    }

    Sentry.setTags({
        "generate_via": via,
        "generate_billable": billable
    });

    const userAgent = simplifyUserAgent(rawUserAgent);

    logger.debug(`${ req.breadcrumbC } Agent:       ${ req.headers["user-agent"] }`, {
        breadcrumb: req.breadcrumb,
        userAgent: req.headers["user-agent"]
    });
    if (req.headers['origin']) {
        logger.debug(`${ req.breadcrumbC } Origin:      ${ req.headers['origin'] }`, {
            breadcrumb: req.breadcrumb,
            origin: req.headers['origin']
        });
    }
    console.log(debug(`${ req.breadcrumbC } Key:         ${ req.apiKey?.name ?? "none" } ${ req.apiKey?._id ?? "" }`));

    const client: ClientInfo = {
        time: Date.now(),
        key: req.apiKeyId,
        agent: userAgent.ua,
        origin: origin,
        ip: ip,
        billable: billable,
        breadcrumb: req.breadcrumb || '00000000',
        user: undefined //TODO
    };
    req.client = client;

    next();
}