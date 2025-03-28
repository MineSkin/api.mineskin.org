import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { getIp, getVia, simplifyUserAgent } from "../util";
import * as Sentry from "@sentry/node";
import { GrantsService, RequestClient, TYPES as GeneratorTypes } from "@mineskin/generator";
import { Log } from "../Log";
import process from "node:process";
import { container } from "../inversify.config";

export const clientMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    initRequestClient(req, res);
    next();
}

export const initRequestClient = (req: MineSkinV2Request, res: Response) => {
    Sentry.startSpan({
        op: 'middleware',
        name: 'initRequestClient'
    }, span => {
        const rawUserAgent = req.header("mineskin-user-agent") || req.header("user-agent") || "n/a";
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

        Log.l.debug(`${ req.breadcrumbC } Agent:       ${ req.headers["mineskin-user-agent"] || '' } ${ req.headers["user-agent"] }`);
        if (req.headers['origin']) {
            Log.l.debug(`${ req.breadcrumbC } Origin:      ${ req.headers['origin'] }`);
        }
        Log.l.debug(`${ req.breadcrumbC } IP:          ${ ip }`);

        if (!res.hasHeader("MineSkin-Api-Version")) {
            res.header("MineSkin-Api-Version", "v2");
        }

        res.header("MineSkin-Version", `api-${ process.env.SOURCE_COMMIT || "dev" }`);

        req.client = new RequestClient(Date.now(), userAgent.ua, origin, ip, via);
    })
}

export const clientFinalMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    await finalizeRequestClient(req, res);
    next();
}

export const finalizeRequestClient = async (req: MineSkinV2Request, res: Response) => {
    return await Sentry.startSpan({
        op: 'middleware',
        name: 'finalizeRequestClient'
    }, async span => {
        try {
            await req.client.applyGrants(container.get<GrantsService>(GeneratorTypes.GrantsService));
        } catch (e) {
            Sentry.captureException(e);
        }
        req.clientInfo = await req.client.asClientInfo(req);
        Sentry.setUser({
            id: req.clientInfo.user,
            username: `${ req.clientInfo.key } ${ req.clientInfo.agent }`,
            ip_address: `${ req.clientInfo.ip }`
        });
    })
}

