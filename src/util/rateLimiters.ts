import { Request } from "express";
import rateLimit from "express-rate-limit";
import { getAndValidateRequestApiKey, getIp } from "./index";
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
    skip: (req, res) => {
        if (req.path.includes("user")) return false; // always limit user, doesn't have check-only option
        return !!(req.body["checkOnly"] || req.query["checkOnly"])
    },
    message: JSON.stringify({ error: "Too many requests" }),
    keyGenerator: keyGenerator,
    //TODO
    // handler: (request: Request, response: Response, options: Options) => {
    //     if (request.rateLimit.used === request.rateLimit.limit + 1) {
    //         // onLimitReached code here
    //         console.log(debug(`${ getIp(request) } (${ request.header("user-agent") }) reached their rate limit`));
    //         MineSkinMetrics.get().then(metrics => {
    //             metrics.rateLimit
    //                 .tag("server", metrics.config.server)
    //                 .tag("limiter", "express")
    //                 .inc();
    //         })
    //     }
    //     response.status(options.statusCode).send(options.message)
    // }
});