import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { CreditType, MineSkinError, RateLimitInfo } from "@mineskin/types";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { TrafficService, TYPES as GeneratorTypes } from "@mineskin/generator";
import { BillingService, TYPES as BillingTypes, UserCreditHolder } from "@mineskin/billing";
import { container } from "../../inversify.config";

export async function v2GetDelay(req: MineSkinV2Request, res: Response<V2MiscResponseBody>) {
    if (!req.clientInfo) {
        throw new MineSkinError('invalid_client', "no client info", {httpCode: 500});
    }

    const now = Date.now();

    const trafficService = container.get<TrafficService>(GeneratorTypes.TrafficService);
    const billingService = container.get<BillingService>(BillingTypes.BillingService);

    let creditType: CreditType | undefined;
    if (req.client.canUseCredits() && req.client.userId) {
        const holder = await billingService.creditService.getHolder(req.client.userId) as UserCreditHolder;
        const credit = await holder.findFirstApplicableMongoCredit(await req.client.usePaidCredits());
        creditType = credit?.type;
    }
    const nextRequest = await trafficService.getNextRequest(req.clientInfo);
    const effectiveDelay = await trafficService.getMinDelaySeconds(req.clientInfo, req.apiKey, creditType) * 1000;

    const [requestCounter, requestCountExp] = await trafficService.getRequestCounter(req.clientInfo);

    const rateLimit: RateLimitInfo = {
        delay: {
            millis: effectiveDelay,
            seconds: effectiveDelay / 1000
        },
        next: {
            absolute: nextRequest || now,
            relative: Math.max(0, (nextRequest || now) - now)
        },
        limit: {
            limit: req.client.getPerMinuteRateLimit(),
            remaining: Math.max(0, req.client.getPerMinuteRateLimit() - requestCounter)
        }
    }

    res.json({
        success: true,
        rateLimit: rateLimit
    })
}
