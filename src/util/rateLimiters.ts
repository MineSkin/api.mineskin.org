import { Request, Response } from "express";
import * as rateLimit from "express-rate-limit";
import { getIp } from "./index";
import { debug } from "./colors";
import { RATE_LIMIT_METRIC } from "./metrics";
import { getConfig } from "../typings/Configs";
import { DEFAULT_DELAY, Generator, MIN_ACCOUNT_DELAY } from "../generator/Generator";

const config = getConfig();

function keyGenerator(req: Request): string {
    return getIp(req);
}

const GEN_LIMIT_WINDOW = 60;
export const generateLimiter = rateLimit({
    windowMs: GEN_LIMIT_WINDOW * 1000,
    max: async () => {
        return Math.min(GEN_LIMIT_WINDOW / Math.max(await Generator.getMinDelay(), DEFAULT_DELAY))
    },
    message: JSON.stringify({ error: "Too many requests" }),
    keyGenerator: keyGenerator,
    onLimitReached: (req: Request, res: Response) => {
        console.log(debug(`${ getIp(req) } (${ req.header("user-agent") }) reached their rate limit`));
        RATE_LIMIT_METRIC
            .tag("server", config.server)
            .tag("limiter", "express")
            .inc();
    }
});
