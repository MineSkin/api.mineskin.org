import { Request } from "express";
import * as rateLimit from "express-rate-limit";


function keyGenerator(req: Request): string {
    return req.get('cf-connecting-ip') || req.get('x-forwarded-for') || req.get("x-real-ip") || req.connection.remoteAddress || req.ip
}

export const generateLimiter = rateLimit({
    windowMs: 2 * 60 * 1000, // 2 minutes,
    max: 6,
    message: JSON.stringify({ error: "Too many requests" }),
    keyGenerator: keyGenerator
});
