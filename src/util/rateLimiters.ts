import { Request } from "express";
import * as rateLimit from "express-rate-limit";
import { getIp } from "./index";


function keyGenerator(req: Request): string {
    return getIp(req);
}

export const generateLimiter = rateLimit({
    windowMs: 2 * 60 * 1000, // 2 minutes,
    max: 6,
    message: JSON.stringify({ error: "Too many requests" }),
    keyGenerator: keyGenerator
});
