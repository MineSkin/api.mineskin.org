import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { MineSkinError, RateLimitInfo } from "@mineskin/types";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { TrafficService } from "@mineskin/generator";
import { BillingService } from "@mineskin/billing";
import { container } from "tsyringe";

export async function v2GetDelay(req: MineSkinV2Request, res: Response<V2MiscResponseBody>) {
    if (!req.clientInfo) {
        throw new MineSkinError('invalid_client', "no client info", {httpCode: 500});
    }

    const now = Date.now();

    const trafficService = container.resolve(TrafficService);
    const billingService = container.resolve(BillingService);

    const credits = req.client.canUseCredits() ? await billingService.getClientCredits(req.clientInfo) : undefined;

    const nextRequest = await trafficService.getNextRequest(req.clientInfo);
    const effectiveDelay = await trafficService.getMinDelaySeconds(req.clientInfo, req.apiKey, credits) * 1000;

    const requestCounter = await trafficService.getRequestCounter(req.clientInfo);

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
