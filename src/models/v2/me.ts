import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { isBillableClient, MineSkinError } from "@mineskin/types";
import { formatV2Response } from "../../middleware/response";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { User } from "@mineskin/database";

export async function v2GetMe(req: MineSkinV2Request, res: Response<V2MiscResponseBody>) {
    req.links.self = `/v2/me`;
    if (req.apiKey) {
        req.links.key = `/v2/me/apikey`;
    }
    if (req.client) {
        req.links.client = `/v2/me/client`;
    }
    if (req.client?.user) {
        const userDoc = await User.findByUUID(req.client.user);
        if (userDoc) {
            req.links.user = `/v2/me`;
            res.json(formatV2Response<V2MiscResponseBody>(req, {
                user: {
                    uuid: userDoc?.uuid,
                    grants: userDoc?.grants
                }
            }));
            return;
        }
    }
    throw new MineSkinError('user_not_found', "User not found", {httpCode: 404});
}

export async function v2GetKeyInfo(req: MineSkinV2Request, res: Response<V2MiscResponseBody>) {
    if (!req.apiKey) {
        throw new MineSkinError('invalid_api_key', "Invalid API key");
    }
    res.json(formatV2Response<V2MiscResponseBody>(req, {
        key: req.apiKey.toSimplified()
    }))
}

export async function v2GetClientInfo(req: MineSkinV2Request, res: Response<V2MiscResponseBody>) {
    if (!req.client) {
        throw new MineSkinError('invalid_client', "Invalid client");
    }
    res.json(formatV2Response<V2MiscResponseBody>(req, {
        client: {
            agent: req.client.agent,
            origin: req.client.origin,
            key: req.client.key,
            user: req.client.user,
            ip: req.client.ip,
            billable: req.client.billable,
            metered: isBillableClient(req.client) ? req.client.metered : false,
            credits: isBillableClient(req.client) ? !!req.client.credits : false
        }
    }))
}