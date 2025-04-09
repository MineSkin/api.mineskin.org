import { Caching } from "../generator/Caching";
import { debug } from "../util/colors";
import { getIp } from "../util";
import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import * as Sentry from "@sentry/node";
import { MineSkinError } from "@mineskin/types";


export const apiKeyMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    await verifyApiKey(req, res);
    next();
}

export const verifyApiKey = async (req: MineSkinV2Request, res: Response) => {
    return await Sentry.startSpan({
        op: 'middleware',
        name: 'verifyApiKey'
    }, async span => {
        let keyStr;

        const authHeader = req.header("authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
            keyStr = authHeader.substring("Bearer ".length);
        }

        if (keyStr) {
            req._apiKeyStr = keyStr;

            if (keyStr.length < 64) {
                console.log(debug(`Invalid API Key length: ${ keyStr.length }`));
                throw new MineSkinError("invalid_api_key", "Invalid API Key Length", {
                    httpCode: 403,
                    error: new MineSkinError("invalid_api_key_length", "Invalid API Key Length")
                });
            }

            const key = await Caching.getApiKey(Caching.cachedSha512(keyStr));
            if (!key) {
                throw new MineSkinError("invalid_api_key", "Invalid API Key", {
                    httpCode: 403,
                    error: new MineSkinError("api_key_not_found", "API Key not found")
                });
            }

            key.updateLastUsed(new Date()) // don't await, don't really care
                .catch(e => Sentry.captureException(e));

            req.client.setApiKey(key);

            req.apiKey = key;
            req.apiKeyId = key.id;
            req.apiKeyRef = `${ key.id?.substring(0, 8) } ${ key.name }`;

            Sentry.setTags({
                "generate_api_key": req.apiKeyRef ?? "none"
            });

            // Either a server IP or a client origin, not both
            if (key.allowedIps && key.allowedIps.length > 0) {
                const ip = getIp(req);
                if (!ip || !key.allowedIps.includes(ip.trim())) {
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

            if (await req.client.isBillable()) {
                res.header("MineSkin-Billable", "true");
                if (await req.client.isMetered() && await req.client.usePaidCredits()) {
                    throw new MineSkinError('invalid_billing', "Cannot use metered and credit billing at the same time");
                }
            }
        } else {
            console.log(debug(`${ req.breadcrumbC } Key:         none`));
            req.warnings.push({
                code: "no_api_key",
                message: "No API Key provided"
            });
        }
    });
}