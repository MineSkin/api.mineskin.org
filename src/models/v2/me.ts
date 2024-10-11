import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { MineSkinError } from "@mineskin/types";
import { formatV2Response } from "../../middleware/response";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { BillingService } from "@mineskin/generator";

export async function v2GetMe(req: MineSkinV2Request, res: Response<V2MiscResponseBody>) {
    req.links.self = `/v2/me`;
    if (req.apiKey) {
        req.links.key = `/v2/me/apikey`;
    }
    if (req.client) {
        req.links.client = `/v2/me/client`;
    }
    if (req.user) {
        req.links.user = `/v2/me`;
        res.json(formatV2Response<V2MiscResponseBody>(req, {
            user: req.user,
            grants: req.grants
        }));
        return;
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
            metered: req.client.metered,
            credits: req.client.credits
        }
    }))
}


export async function v2GetCreditsInfo(req: MineSkinV2Request, res: Response<V2MiscResponseBody>) {
    if (!req.client) {
        throw new MineSkinError('invalid_client', "Invalid client");
    }
    if (!req.user) {
        throw new MineSkinError('invalid_user', "Invalid user");
    }
    const credit = await BillingService.getInstance().getClientCredits(req.client);
    if (!credit) {
        req.warnings.push({
            code: 'no_credits',
            message: "no credits"
        });
    } else {
        if (!credit.isValid()) {
            req.warnings.push({
                code: 'invalid_credits',
                message: "invalid credits"
            });
        } else if (credit.balance <= 0) {
            req.warnings.push({
                code: 'insufficient_credits',
                message: "insufficient credits"
            });
        }
        res.header('X-MineSkin-Credits-Type', credit.type);
        res.header('X-MineSkin-Credits-Balance', `${ credit.balance }`);
    }
    res.json(formatV2Response<V2MiscResponseBody>(req, {
        credit: {
            type: credit?.type,
            balance: credit?.balance,
            total: credit?.total
        }
    }));
}