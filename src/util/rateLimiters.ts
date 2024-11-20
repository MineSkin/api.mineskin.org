import { NextFunction, Request, Response } from "express";
import rateLimit, { Options } from "express-rate-limit";
import { getAndValidateRequestApiKey, getIp, simplifyUserAgent } from "./index";
import { Generator } from "../generator/Generator";
import { Log } from "../Log";
import { container } from "../inversify.config";
import { IMetricsProvider } from "@mineskin/core";
import { TYPES as CoreTypes } from "@mineskin/core/dist/ditypes";
import { HOSTNAME } from "./host";
import * as Sentry from "@sentry/node";

function keyGenerator(req: Request): string {
    return getIp(req);
}

const GEN_LIMIT_WINDOW = 10;
export const generateLimiter = rateLimit({
    windowMs: GEN_LIMIT_WINDOW * 1000,
    max: async (req, res) => {
        const delay = await Generator.getDelay(await getAndValidateRequestApiKey(req))
        return Math.ceil(GEN_LIMIT_WINDOW / delay.seconds);
    },
    skip: (req, res) => {
        if (req.path.includes("user")) return false; // always limit user, doesn't have check-only option
        return !!(req.body["checkOnly"] || req.query["checkOnly"])
    },
    message: {
        error: "Too many requests",
        limiter: "express",
        delayInfo: {
            seconds: 5,
            millis: 5000
        }
    },
    keyGenerator: keyGenerator,
    handler: (request: Request, response: Response, next: NextFunction, options: Options) => {
        // onLimitReached code here
        const agent = simplifyUserAgent(request.headers["user-agent"] as string);
        Log.l.warn(`${ agent.ua } ${ getIp(request) } reached their rate limit`);
        try {
            const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
            metrics.getMetric('api_rate_limit')
                .tag("server", HOSTNAME)
                .tag("limiter", "express")
                .tag("ua", agent.ua)
                .inc();
        } catch (e) {
            Sentry.captureException(e);
        }
        response.status(options.statusCode).json(options.message)
    }
});

export const validateLimiter = rateLimit({
    windowMs: 10000,
    limit: 5,
    message: {
        error: "Too many requests",
        limiter: "express"
    },
    keyGenerator: keyGenerator
});