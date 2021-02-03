import { Request, Response } from "express";
import * as rateLimit from "express-rate-limit";
import { getIp } from "./index";
import { debug } from "./colors";


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
    }
});
