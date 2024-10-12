import { GenerateV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { GeneratorError, TrafficService } from "@mineskin/generator";

export const rateLimitMiddleware = async (req: GenerateV2Request, res: Response, next: NextFunction) => {
    if (!req.clientInfo) {
        throw new GeneratorError('invalid_client', "no client info", {httpCode: 500});
    }

    // check rate limit
    const trafficService = TrafficService.getInstance();
    if(req.client.useDelayRateLimit()) {
        req.nextRequest = await trafficService.getNextRequest(req.clientInfo);
        req.minDelay = await trafficService.getMinDelaySeconds(req.clientInfo, req.apiKey) * 1000;
        if (req.nextRequest > req.clientInfo.time) {
            throw new GeneratorError('rate_limit', `request too soon, next request in ${ ((Math.round(req.nextRequest - Date.now()) / 100) * 100) }ms`, {httpCode: 429});
        }
    }
    if (req.client.usePerMinuteRateLimit()) {
        const counter = await trafficService.getCounter(req.clientInfo);
        const limit = req.client.getPerMinuteRateLimit();
        if (counter > limit) {
            throw new GeneratorError('rate_limit', `rate limit exceeded, ${ counter } > ${ limit }`, {httpCode: 429});
        }
    }

    next();
}