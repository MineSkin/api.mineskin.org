import { GenerateV2Request, MineSkinV2Request } from "../routes/v2/types";
import { V2ResponseBody } from "../typings/v2/V2ResponseBody";
import { V2GenerateResponseBody } from "../typings/v2/V2GenerateResponseBody";
import { V2GenerateHandler } from "../generator/v2/V2GenerateHandler";

export function formatV2Response<B extends V2ResponseBody>(req: MineSkinV2Request, body: Partial<B>): B {
    if (!('success' in body)) {
        body.success = true;
    }
    if (body.warnings) {
        body.warnings = [...req.warnings, ...body.warnings];
    } else {
        body.warnings = req.warnings;
    }
    if (body.messages) {
        body.messages = [...req.messages, ...body.messages];
    } else {
        body.messages = req.messages;
    }
    if (body.links) {
        body.links = {...req.links, ...body.links};
    } else {
        body.links = req.links;
    }
    return body as B;
}

export function formatV2GenerateResponse<B extends V2GenerateResponseBody>(req: GenerateV2Request, body: Partial<B>): B {
    const b = formatV2Response(req, body);
    if (!b.rateLimit) {
        b.rateLimit = V2GenerateHandler.makeRateLimitInfo(req);
    }
    if (!b.usage) {
        b.usage = {};
    }
    if (!b.usage.limit) {
        b.usage.limit = {
            limit: req.maxPerMinute || 0,
            remaining: (req.maxPerMinute || 0) - (req.requestsThisMinute || 0),
        }
    }
    return b as B;
}