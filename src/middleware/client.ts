import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { getIp, getVia, simplifyUserAgent } from "../util";
import * as Sentry from "@sentry/node";
import { logger } from "../util/log";
import { debug } from "../util/colors";
import { BillableClient, ClientInfo, CreditType, Maybe } from "@mineskin/types";

export const mineskinClientMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    const rawUserAgent = req.header("user-agent") || "n/a";
    const origin = req.header("origin");
    const ip = getIp(req);
    const via = getVia(req);

    let user: Maybe<string>;
    let billable = false;
    let metered = false;
    let useCredits = false;
    if (req.apiKey) {
        user = req.apiKey.user;
        billable = req.apiKey.billable || false;
        metered = req.apiKey.metered || false;
        useCredits = req.apiKey.useCredits || false;
        billable = billable || metered || useCredits;
    }

    Sentry.setTags({
        "generate_via": via,
        "generate_billable": billable
    });

    const userAgent = simplifyUserAgent(rawUserAgent);
    if (userAgent.generic) {
        req.warnings.push({
            code: "generic_user_agent",
            message: "User agent is generic. Please use a more specific user agent."
        })
    }

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
    console.log(debug(`${ req.breadcrumbC } Key:         ${ req.apiKeyRef ?? "none" }`));

    const client: ClientInfo | BillableClient = {
        time: Date.now(),
        key: req.apiKeyId,
        agent: userAgent.ua,
        origin: origin,
        ip: ip,
        breadcrumb: req.breadcrumb || '00000000',
        user: user,

        billable: billable,
        metered: metered,
        credits: useCredits ? CreditType.AUTO : undefined //TODO: maybe allow specifying type of credits
    };
    req.client = client;

    res.header("X-MineSkin-Api-Version", "v2");

    next();
}