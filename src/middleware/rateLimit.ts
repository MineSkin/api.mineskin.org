import { GenerateV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { GeneratorError, TrafficService, TYPES as GeneratorTypes } from "@mineskin/generator";
import { container } from "../inversify.config";
import { IFlagProvider, TYPES as CoreTypes } from "@mineskin/core";
import { Log } from "../Log";

export const rateLimitMiddlewareWithDelay = async (req: GenerateV2Request, res: Response, next: NextFunction) => {
    await verifyRateLimit(req, res, true);
    next();
}

export const rateLimitMiddleware = async (req: GenerateV2Request, res: Response, next: NextFunction) => {
    await verifyRateLimit(req, res, false);
    next();
}

export const globalDelayInitMiddleware = async (req: GenerateV2Request, res: Response, next: NextFunction) => {
    if (!req.clientInfo) {
        throw new GeneratorError('invalid_client', "no client info", {httpCode: 500});
    }

    const trafficService = container.get<TrafficService>(GeneratorTypes.TrafficService);
    if (req.client.useDelayRateLimit()) {
        req.nextRequest = await trafficService.getNextRequest(req.clientInfo);
        req.minDelay = await trafficService.getMinDelaySeconds(req.clientInfo, req.apiKey, undefined) * 1000;
        res.header('X-RateLimit-Delay', `${ req.minDelay }`);
        res.header('X-RateLimit-NextRequest', `${ req.nextRequest }`);
    }

    next();
}

export const globalDelayRateLimitMiddleware = async (req: GenerateV2Request, res: Response, next: NextFunction) => {
    if (!req.clientInfo) {
        throw new GeneratorError('invalid_client', "no client info", {httpCode: 500});
    }

    if (req.nextRequest && req.client.useDelayRateLimit()) {
        if (req.nextRequest > req.clientInfo.time) {
            res.header('Retry-After', `${ Math.round((req.nextRequest - Date.now()) / 1000) }`);
            Log.l.warn(`${ req.client.apiKeyRef }/${ req.client.userAgent } speed limit exceeded, ${ req.nextRequest } > ${ req.clientInfo.time } (${ req.nextRequest - req.clientInfo.time })`);
            throw new GeneratorError('rate_limit', `request too soon, next request in ${ ((Math.round(req.nextRequest - Date.now()) / 100) * 100) }ms`, {httpCode: 429});
        }
    }


    next();
}

export const globalPerMinuteInitMiddleware = async (req: GenerateV2Request, res: Response, next: NextFunction) => {
    if (!req.clientInfo) {
        throw new GeneratorError('invalid_client', "no client info", {httpCode: 500});
    }

    const trafficService = container.get<TrafficService>(GeneratorTypes.TrafficService);
    if (req.client.usePerMinuteRateLimit()) {
        const [counter, exp] = await trafficService.getRequestCounter(req.clientInfo);
        req.requestsThisMinute = counter;
        req.maxPerMinute = req.client.getPerMinuteRateLimit();
        res.header('X-RateLimit-Limit', `${ req.maxPerMinute }`);
        res.header('X-RateLimit-Remaining', `${ req.maxPerMinute - req.requestsThisMinute }`);
        res.header('X-RateLimit-Reset', `${ Math.round(exp) }`);
    }


    next();
}

export const globalPerMinuteRateLimitMiddleware = async (req: GenerateV2Request, res: Response, next: NextFunction) => {
    if (!req.clientInfo) {
        throw new GeneratorError('invalid_client', "no client info", {httpCode: 500});
    }

    if (req.maxPerMinute && req.requestsThisMinute && req.client.usePerMinuteRateLimit()) {
        const flags = container.get<IFlagProvider>(CoreTypes.FlagProvider);
        const [block, blockAnonymous] = await Promise.all([
            flags.isEnabled('generator.per_minute.block'),
            flags.isEnabled('generator.per_minute.block_anonymous')
        ]);
        const shouldBlock = block || (blockAnonymous && !req.client.hasUser() && !req.client.hasApiKey());
        if (shouldBlock && req.requestsThisMinute > req.maxPerMinute) {
            Log.l.warn(`${ req.client.apiKeyRef }/${ req.client.userAgent } rate limit exceeded, ${ req.requestsThisMinute } > ${ req.maxPerMinute }`);
            throw new GeneratorError('rate_limit', `rate limit exceeded, ${ req.requestsThisMinute } > ${ req.maxPerMinute }`, {httpCode: 429});
        }
    }


    next();
}

export const globalConcurrencyInitMiddleware = async (req: GenerateV2Request, res: Response, next: NextFunction) => {
    if (!req.clientInfo) {
        throw new GeneratorError('invalid_client', "no client info", {httpCode: 500});
    }

    const trafficService = container.get<TrafficService>(GeneratorTypes.TrafficService);
    if (req.client.useConcurrencyLimit()) {
        req.concurrentRequests = await trafficService.getConcurrent(req.clientInfo);
        req.maxConcurrent = req.client.getConcurrencyLimit();
    }


    next();
}

export const globalConcurrencyLimitMiddleware = async (req: GenerateV2Request, res: Response, next: NextFunction) => {
    if (!req.clientInfo) {
        throw new GeneratorError('invalid_client', "no client info", {httpCode: 500});
    }

    if (req.concurrentRequests && req.maxConcurrent && req.client.useConcurrencyLimit()) {
        const flags = container.get<IFlagProvider>(CoreTypes.FlagProvider);
        const block = await flags.isEnabled('generator.concurrency.block');
        if (block && req.concurrentRequests >= req.maxConcurrent) {
            Log.l.warn(`${ req.client.apiKeyRef }/${ req.client.userAgent } concurrency limit exceeded, ${ req.concurrentRequests } > ${ req.maxConcurrent }`);
            throw new GeneratorError('concurrency_limit', `concurrency limit exceeded, ${ req.concurrentRequests } > ${ req.maxConcurrent }`, {httpCode: 429});
        }
    }


    next();
}

export const verifyRateLimit = async (req: GenerateV2Request, res: Response, withDelay: boolean) => {
    if (!req.clientInfo) {
        throw new GeneratorError('invalid_client', "no client info", {httpCode: 500});
    }

    // check rate limit
    const trafficService = container.get<TrafficService>(GeneratorTypes.TrafficService);
    if (withDelay && req.client.useDelayRateLimit()) {
        const credits = await req.client?.getCredits();
        req.nextRequest = await trafficService.getNextRequest(req.clientInfo);
        req.minDelay = await trafficService.getMinDelaySeconds(req.clientInfo, req.apiKey, credits?.type) * 1000;
        res.header('X-RateLimit-Delay', `${ req.minDelay }`);
        res.header('X-RateLimit-NextRequest', `${ req.nextRequest }`);
        if ((req as any).v2Compat) {
            res.header('MineSkin-Delay-Millis', `${ req.minDelay }`); // deprecated
            res.header('MineSkin-Delay-Seconds', `${ Math.ceil(req.minDelay / 1000) }`); // deprecated
            res.header('MineSkin-Delay', `${ Math.ceil(req.minDelay / 1000) }`); // deprecated
        }
        if (req.nextRequest > req.clientInfo.time) {
            res.header('Retry-After', `${ Math.round((req.nextRequest - Date.now()) / 1000) }`);
            Log.l.warn(`${ req.client.apiKeyRef }/${ req.client.userAgent } speed limit exceeded, ${ req.nextRequest } > ${ req.clientInfo.time } (${ req.nextRequest - req.clientInfo.time })`);
            throw new GeneratorError('rate_limit', `request too soon, next request in ${ ((Math.round(req.nextRequest - Date.now()) / 100) * 100) }ms`, {httpCode: 429});
        }
    }

    if (req.client.usePerMinuteRateLimit()) {
        const flags = container.get<IFlagProvider>(CoreTypes.FlagProvider);
        const [block, blockAnonymous] = await Promise.all([
            flags.isEnabled('generator.per_minute.block'),
            flags.isEnabled('generator.per_minute.block_anonymous')
        ]);
        const shouldBlock = block || (blockAnonymous && !req.client.hasUser() && !req.client.hasApiKey());
        const [counter, exp] = await trafficService.getRequestCounter(req.clientInfo);
        req.requestsThisMinute = counter;
        req.maxPerMinute = req.client.getPerMinuteRateLimit();
        res.header('X-RateLimit-Limit', `${ req.maxPerMinute }`);
        res.header('X-RateLimit-Remaining', `${ req.maxPerMinute - req.requestsThisMinute - 1 }`);
        res.header('X-RateLimit-Reset', `${ Math.round(exp) }`);
        if (shouldBlock && req.requestsThisMinute >= req.maxPerMinute) {
            Log.l.warn(`${ req.client.apiKeyRef }/${ req.client.userAgent } rate limit exceeded, ${ req.requestsThisMinute } > ${ req.maxPerMinute }`);
            throw new GeneratorError('rate_limit', `rate limit exceeded, ${ req.requestsThisMinute } > ${ req.maxPerMinute }`, {httpCode: 429});
        }
    }

    if (req.client.useConcurrencyLimit()) {
        const flags = container.get<IFlagProvider>(CoreTypes.FlagProvider);
        const block = await flags.isEnabled('generator.concurrency.block');
        req.concurrentRequests = await trafficService.getConcurrent(req.clientInfo);
        req.maxConcurrent = req.client.getConcurrencyLimit();
        if (block && req.concurrentRequests >= req.maxConcurrent) {
            Log.l.warn(`${ req.client.apiKeyRef }/${ req.client.userAgent } concurrency limit exceeded, ${ req.concurrentRequests } > ${ req.maxConcurrent }`);
            throw new GeneratorError('concurrency_limit', `concurrency limit exceeded, ${ req.concurrentRequests } > ${ req.maxConcurrent }`, {httpCode: 429});
        }
    }
}