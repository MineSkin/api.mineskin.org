import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { CreditsUsageInfo, CreditType, MineSkinError, UsageInfo } from "@mineskin/types";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { BillingService, TYPES as BillingTypes, UserCreditHolder } from "@mineskin/billing";
import { TrafficService, TYPES as GeneratorTypes } from "@mineskin/generator";
import { container } from "../../inversify.config";


export async function v2GetUsageInfo(req: MineSkinV2Request, res: Response<V2MiscResponseBody>): Promise<UsageInfo> {
    if (!req.clientInfo) {
        throw new MineSkinError('invalid_client', "Invalid client");
    }
    if (!req.client.hasUser() || !req.client.userId) {
        throw new MineSkinError('invalid_user', "Invalid user");
    }

    const info: UsageInfo = {};

    {
        const billingService = container.get<BillingService>(BillingTypes.BillingService);
        const holder = await billingService.creditService.getHolder(req.client.userId) as UserCreditHolder;

        const totalBalanceRedis = Math.max(holder.getFreeCreditsNow(), 0) + Math.max(holder.getGeneralCreditsNow(), 0);
        const totalBalanceMongo = await holder.getMongoTypeBalance(CreditType.FREE, CreditType.INTERNAL, CreditType.REWARD, CreditType.PAID);
        const total = await holder.getMongoTypeTotal(CreditType.FREE, CreditType.INTERNAL, CreditType.REWARD, CreditType.PAID);

        const remaining = Math.min(totalBalanceRedis, totalBalanceMongo);
        const used = total - remaining;

        info.credits = {
            remaining,
            used
        } as CreditsUsageInfo; //FIXME: make id+type optional
    }

    {
        const trafficService = container.get<TrafficService>(GeneratorTypes.TrafficService);

        const thisMinute = await trafficService.getRequestCounter(req.clientInfo);
        const limit = req.client.getPerMinuteRateLimit();
        const remaining = limit - thisMinute;

        info.limit = {
            limit,
            remaining
        };
    }

    //TODO: add metered usage
    //TODO: add concurrency info

    return info;
}