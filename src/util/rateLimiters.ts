import { NextFunction, Request, Response } from "express";
import rateLimit, { Options } from "express-rate-limit";
import { getAndValidateRequestApiKey, getIp, simplifyUserAgent } from "./index";
import { Generator } from "../generator/Generator";
import { MineSkinMetrics } from "./metrics";
import { logger } from "./log";

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
        logger.warn(`${ agent.ua } ${ getIp(request) } reached their rate limit`);
        MineSkinMetrics.get().then(metrics => {
            metrics.rateLimit
                .tag("server", metrics.config.server)
                .tag("limiter", "express")
                .tag("ua", agent.ua)
                .inc();
        })
        response.status(options.statusCode).json(options.message)
    }
});