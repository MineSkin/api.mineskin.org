import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { CreditType, MineSkinError } from "@mineskin/types";
import { formatV2Response } from "../../middleware/response";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { BillingService, TYPES as BillingTypes, UserCreditHolder } from "@mineskin/billing";
import { ApiKey } from "@mineskin/database";
import { container } from "../../inversify.config";

export async function v2GetMe(req: MineSkinV2Request, res: Response<V2MiscResponseBody>) {
    req.links.self = `/v2/me`;
    if (req.apiKey) {
        req.links.key = `/v2/me/apikey`;
    }
    if (req.clientInfo) {
        req.links.client = `/v2/me/client`;
    }
    // if (req.client.canUseCredits()) {
    //     req.links.credits = `/v2/me/credits`;
    // }
    if (req.client.hasUser()) {
        req.links.user = `/v2/me`;
        res.json(formatV2Response<V2MiscResponseBody>(req, {
            user: req.client.userId,
            grants: req.client.grants
        }));
        return;
    }
    throw new MineSkinError('user_not_found', "User not found", {httpCode: 404});
}

export async function v2ListKeys(req: MineSkinV2Request, res: Response<V2MiscResponseBody>) {
    if (!req.client.hasUser()) {
        throw new MineSkinError('unauthorized', 'Unauthorized', {httpCode: 401});
    }
    const keys = await ApiKey.findByUser(req.client.userId!)
    res.json(formatV2Response<V2MiscResponseBody>(req, {
        keys: keys.map(k => {
            return {
                id: k.id,
                name: k.name,
                billable: k.billable,
                useCredits: k.useCredits,
                metered: k.metered,
                grants: k.grants
            }
        })
    }))
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
    if (!req.clientInfo) {
        throw new MineSkinError('invalid_client', "Invalid client");
    }
    res.json(formatV2Response<V2MiscResponseBody>(req, {
        client: {
            agent: req.clientInfo.agent,
            origin: req.clientInfo.origin,
            key: req.clientInfo.key,
            user: req.clientInfo.user,
            ip: req.clientInfo.ip,
            billable: req.clientInfo.billable,
            metered: req.clientInfo.metered,
            credits: req.clientInfo.credits
        }
    }))
}


export async function v2GetCreditsInfo(req: MineSkinV2Request, res: Response<V2MiscResponseBody>) {
    if (!req.clientInfo) {
        throw new MineSkinError('invalid_client', "Invalid client");
    }
    if (!req.client.hasUser() || !req.client.userId) {
        throw new MineSkinError('invalid_user', "Invalid user");
    }
    const billingService = container.get<BillingService>(BillingTypes.BillingService);
    const holder = await billingService.creditService.getHolder(req.client.userId) as UserCreditHolder;
    const credit = await holder.findFirstApplicableMongoCredit(false);
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
        res.header('MineSkin-Credits-Type', credit.type);
        res.header('MineSkin-Credits-Balance', `${ credit.balance }`);
    }
    // let balance = credit?.balance || 0;
    // let total = credit?.total || 0;
    // if (credit && credit.isValid() && !credit.isExpired() && credit.balance > 0) {
    //     const allAvailable = await container.resolve(BillingService).creditService.getAllValidCredits(req.clientInfo.user!);
    //     if (allAvailable) {
    //         for (const available of allAvailable) {
    //             if (available.id === credit.id) continue;
    //             if (available.isValid() && !available.isExpired() && available.balance > 0) {
    //                 balance += available.balance;
    //                 total += available.total;
    //             }
    //         }
    //     }
    // }
    const totalBalanceRedis = Math.max(holder.getFreeCreditsNow(), 0) + Math.max(holder.getGeneralCreditsNow(), 0);
    const totalBalanceMongo = await holder.getMongoTypeBalance(CreditType.FREE, CreditType.INTERNAL, CreditType.REWARD, CreditType.PAID);
    const total = await holder.getMongoTypeTotal(CreditType.FREE, CreditType.INTERNAL, CreditType.REWARD, CreditType.PAID);
    res.json(formatV2Response<V2MiscResponseBody>(req, {
        credit: {
            current: {
                type: credit?.type,
                balance: credit?.balance,
                total: credit?.total
            },
            all: {
                balance: Math.min(totalBalanceRedis, totalBalanceMongo),
                total: total
            }
        }
    }));
}