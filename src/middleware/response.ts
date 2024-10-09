import { MineSkinV2Request } from "../routes/v2/types";
import { V2ResponseBody } from "../typings/v2/V2ResponseBody";

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