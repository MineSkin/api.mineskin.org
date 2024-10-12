import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { MineSkinError, RateLimitInfo } from "@mineskin/types";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { BillingService, TrafficService } from "@mineskin/generator";

export async function v2GetDelay(req: MineSkinV2Request, res: Response<V2MiscResponseBody>) {
    if (!req.clientInfo) {
        throw new MineSkinError('invalid_client', "no client info", {httpCode: 500});
    }

    const now = Date.now();

    const trafficService = TrafficService.getInstance();
    const billingService = BillingService.getInstance();

    const credits = req.client.canUseCredits() ? await billingService.getClientCredits(req.clientInfo) : undefined;

    const nextRequest = await trafficService.getNextRequest(req.clientInfo);
    const effectiveDelay = await trafficService.getMinDelaySeconds(req.clientInfo, req.apiKey, credits) * 1000;

    const rateLimit: RateLimitInfo = {
        delay: {
            millis: effectiveDelay,
            seconds: effectiveDelay / 1000
        },
        next: {
            absolute: nextRequest || now,
            relative: Math.max(0, (nextRequest || now) - now)
        }
    }

    res.json({
        success: true,
        rateLimit: rateLimit
    })
}
