import { GenerateV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { GeneratorError, TrafficService } from "@mineskin/generator";
import { flagsmith } from "@mineskin/generator/dist/flagsmith";

export const rateLimitMiddleware = async (req: GenerateV2Request, res: Response, next: NextFunction) => {
    await verifyRateLimit(req, res);
    next();
}

export const verifyRateLimit = async (req: GenerateV2Request, res: Response) => {
    if (!req.clientInfo) {
        throw new GeneratorError('invalid_client', "no client info", {httpCode: 500});
    }

    // check rate limit
    const trafficService = TrafficService.getInstance();
    if (req.client.useDelayRateLimit()) {
        req.nextRequest = await trafficService.getNextRequest(req.clientInfo);
        req.minDelay = await trafficService.getMinDelaySeconds(req.clientInfo, req.apiKey) * 1000;
        res.header('X-RateLimit-Delay', `${ req.minDelay }`);
        res.header('X-RateLimit-NextRequest', `${ req.nextRequest }`);
        if (req.nextRequest > req.clientInfo.time) {
            res.header('Retry-After', `${ Math.round((req.nextRequest - Date.now()) / 1000) }`);
            throw new GeneratorError('rate_limit', `request too soon, next request in ${ ((Math.round(req.nextRequest - Date.now()) / 100) * 100) }ms`, {httpCode: 429});
        }
    }

    if (req.client.usePerMinuteRateLimit()) {
        req.requestsThisMinute = await trafficService.getRequestCounter(req.clientInfo);
        req.maxPerMinute = req.client.getPerMinuteRateLimit();
        res.header('X-RateLimit-Limit', `${ req.maxPerMinute }`);
        res.header('X-RateLimit-Remaining', `${ req.maxPerMinute - req.requestsThisMinute }`);
        if (req.requestsThisMinute > req.maxPerMinute) {
            throw new GeneratorError('rate_limit', `rate limit exceeded, ${ req.requestsThisMinute } > ${ req.maxPerMinute }`, {httpCode: 429});
        }
    }

    if (req.client.useConcurrencyLimit()) {
        const flags = await flagsmith.getEnvironmentFlags();
        const block = flags.isFeatureEnabled('generator.concurrency.block');
        req.concurrentRequests = await trafficService.getConcurrent(req.clientInfo);
        req.maxConcurrent = req.client.getConcurrencyLimit();
        if (block && req.concurrentRequests >=  req.maxConcurrent) {
            throw new GeneratorError('concurrency_limit', `concurrency limit exceeded, ${ req.concurrentRequests } > ${  req.maxConcurrent }`, {httpCode: 429});
        }
    }
}