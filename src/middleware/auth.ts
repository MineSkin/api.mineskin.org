import { Caching } from "../generator/Caching";
import { debug } from "../util/colors";
import { getIp } from "../util";
import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import * as Sentry from "@sentry/node";
import { MineSkinError } from "@mineskin/types";
import { Caches } from "@inventivetalent/loading-cache";
import { Time } from "@inventivetalent/time";
import * as jose from "jose";
import { JWTPayload } from "jose";
import process from "node:process";

const jwtCache = Caches.builder()
    .expireAfterWrite(Time.seconds(5))
    .expirationInterval(Time.seconds(10))
    .buildAsync<string, JWTPayload>(async str => {
        const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET_API!);
        const decoded = await jose.jwtVerify(str, secret, {
            audience: 'https://api.mineskin.org',
            algorithms: ['HS256'],
            requiredClaims: ['exp', 'iat', 'sub', 'user', 'aud', 'iss']
        });
        return decoded.payload;
    })

export const authMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    let keyStr;

    const authHeader = req.header("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        keyStr = authHeader.substring("Bearer ".length);
    }

    if (!req.grants) {
        req.grants = {};
    }

    if (keyStr) {
        req._apiKeyStr = keyStr;

        //TODO: figure out how to handle this
        // still need API keys for metrics etc., so not sure how to use user
        if(keyStr.startsWith('msu_ey')){ // user JWT
            const decoded = await jwtCache.get(keyStr.substring(4));
        }

        await handleApiKey(keyStr, req, res, next);
    } else {
        console.log(debug(`${ req.breadcrumbC } Key:         none`));
        req.warnings.push({
            code: "no_api_key",
            message: "No API Key provided"
        });

        next();
    }
}

const handleApiKey = async (keyStr: string, req: MineSkinV2Request, res: Response, next: NextFunction) => {
    const key = await Caching.getApiKey(Caching.cachedSha512(keyStr));
    if (!key) {
        throw new MineSkinError("invalid_api_key", "Invalid API Key", {httpCode: 403});
    }

    key.updateLastUsed(new Date()); // don't await, don't really care

    req.apiKey = key;
    req.apiKeyId = key.id;
    req.apiKeyRef = `${ key.id?.substring(0, 8) } ${ key.name }`;

    Sentry.setTags({
        "generate_api_key": req.apiKeyRef ?? "none"
    });

    // Either a server IP or a client origin, not both
    if (key.allowedIps && key.allowedIps.length > 0) {
        const ip = getIp(req);
        if (!ip || key.allowedIps.includes(ip.trim())) {
            console.log(debug(`Client ${ ip } not allowed`));
            throw new MineSkinError("invalid_api_key", "Client not allowed", {httpCode: 403});
        }
    } else if (key.allowedOrigins && key.allowedOrigins.length > 0) {
        const origin = req.headers.origin;
        if (!origin || !key.allowedOrigins.includes(origin.trim().toLowerCase())) {
            console.log(debug(`Origin ${ origin } not allowed`));
            throw new MineSkinError("invalid_api_key", "Origin not allowed", {httpCode: 403});
        }
    }

    if (key.allowedAgents && key.allowedAgents.length > 0) {
        const agent = req.headers["user-agent"];
        if (!agent || !key.allowedAgents.includes(agent.trim().toLowerCase())) {
            console.log(debug(`Agent ${ agent } not allowed`));
            throw new MineSkinError("invalid_api_key", "Agent not allowed", {httpCode: 403});
        }
    }

    if (key.grants) {
        req.grants = {...req.grants, ...key.grants};
    }

    next();
}