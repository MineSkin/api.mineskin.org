import { Request, Response } from "express";
import * as rateLimit from "express-rate-limit";
import { getIp } from "./index";
import { debug } from "./colors";
import { RATE_LIMIT_METRIC } from "./metrics";
import { getConfig } from "../typings/Configs";

const config = getConfig();

function keyGenerator(req: Request): string {
    return getIp(req);
}

export const generateLimiter = rateLimit({
    windowMs: 2 * 60 * 1000, // 2 minutes,
    max: 5,
    message: JSON.stringify({ error: "Too many requests" }),
    keyGenerator: keyGenerator,
    onLimitReached: (req: Request, res: Response) => {
        console.log(debug(`${ getIp(req) } reached their rate limit`));
        RATE_LIMIT_METRIC
            .tag("server", config.server)
            .tag("limiter", "express")
            .inc();
    }
});
