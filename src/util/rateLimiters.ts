import { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { getAndValidateRequestApiKey, getIp } from "./index";
import { debug } from "./colors";
import { MineSkinMetrics } from "./metrics";
import { Generator } from "../generator/Generator";

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
    message: JSON.stringify({ error: "Too many requests" }),
    keyGenerator: keyGenerator,
    onLimitReached: (req: Request, res: Response) => {
        console.log(debug(`${ getIp(req) } (${ req.header("user-agent") }) reached their rate limit`));
        MineSkinMetrics.get().then(metrics => {
            metrics.rateLimit
                .tag("server", metrics.config.server)
                .tag("limiter", "express")
                .inc();
        })
    }
});
