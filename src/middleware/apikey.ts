import { Caching } from "../generator/Caching";
import { MineSkinError } from "../typings";
import { debug } from "../util/colors";
import { getIp } from "../util";
import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import * as Sentry from "@sentry/node";

export const apiKeyMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    let keyStr;

    const authHeader = req.headers['Authorization'] as string;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        keyStr = authHeader.substring("Bearer ".length);
    }

    if (keyStr) {
        req._apiKeyStr = keyStr;

        const key = await Caching.getApiKey(Caching.cachedSha512(keyStr));
        if (!key) {
            throw new MineSkinError("invalid_api_key", "Invalid API Key", 403);
        }

        key.updateLastUsed(new Date()); // don't await, don't really care

        req.apiKey = key;
        req.apiKeyId = key.id;
        req.apiKeyRef = `${ key.id?.substring(0, 8) } ${ key.name }`

        Sentry.setTags({
            "generate_api_key": req.apiKeyRef ?? "none"
        });

        // Either a server IP or a client origin, not both
        if (key.allowedIps && key.allowedIps.length > 0) {
            const ip = getIp(req);
            if (!ip || key.allowedIps.includes(ip.trim())) {
                console.log(debug(`Client ${ ip } not allowed`));
                throw new MineSkinError("invalid_api_key", "Client not allowed", 403);
            }
        } else if (key.allowedOrigins && key.allowedOrigins.length > 0) {
            const origin = req.headers.origin;
            if (!origin || !key.allowedOrigins.includes(origin.trim().toLowerCase())) {
                console.log(debug(`Origin ${ origin } not allowed`));
                throw new MineSkinError("invalid_api_key", "Origin not allowed", 403);
            }
        }

        if (key.allowedAgents && key.allowedAgents.length > 0) {
            const agent = req.headers["user-agent"];
            if (!agent || !key.allowedAgents.includes(agent.trim().toLowerCase())) {
                console.log(debug(`Agent ${ agent } not allowed`));
                throw new MineSkinError("invalid_api_key", "Agent not allowed", 403);
            }
        }

        return;
    }

    next();
}