import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import * as Sentry from "@sentry/node";
import { Caches } from "@inventivetalent/loading-cache";
import { Time } from "@inventivetalent/time";
import * as jose from "jose";
import { JWTPayload } from "jose";
import process from "node:process";
import { Log } from "../Log";

const jwtCache = Caches.builder()
    .expireAfterWrite(Time.seconds(5))
    .expirationInterval(Time.seconds(10))
    .buildAsync<string, TokenPayload>(async str => {
        const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET_API!);
        const decoded = await jose.jwtVerify<TokenPayload>(str, secret, {
            audience: 'https://api.mineskin.org',
            algorithms: ['HS256'],
            requiredClaims: ['exp', 'iat', 'sub', 'user', 'aud', 'iss']
        });
        return decoded.payload;
    })

export const jwtMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    await verifyJwtCookie(req, res);
    next();
}

export const verifyJwtCookie = async (req: MineSkinV2Request, res: Response) => {
    return await Sentry.startSpan({
        op: 'middleware',
        name: 'verifyJwtCookie'
    }, async span => {
        const cookie = req.cookies['mskapi'];
        if (!cookie) {
            return;
        }

        try {
            const payload = await jwtCache.get(cookie);
            if (req.apiKey && req.apiKey.user !== payload.user) {
                Log.l.warning(`API Key user ${ req.apiKey.user } does not match JWT user ${ payload.user }`);
            }

            req.client.setUserId(payload.user);
        } catch (e) {
            if (e instanceof jose.errors.JOSEError) {
                req.warnings.push({
                    code: "invalid_jwt",
                    message: "Invalid JWT cookie"
                });
                req.warnings.push({
                    code: e.code,
                    message: e.message
                });
            } else {
                Log.l.error(e);
                Sentry.captureException(e);
            }
        }
    });
}

interface TokenPayload extends JWTPayload {
    sub: string;
    user: string;
    email: string;
    grants?: Record<string, string | number | boolean>;
}