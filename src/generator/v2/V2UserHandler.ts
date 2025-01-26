import { V2GenerateHandler } from "./V2GenerateHandler";
import { GenerateV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { V2GenerateResponseBody } from "../../typings/v2/V2GenerateResponseBody";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { ErrorSource, GenerateOptions, GenerateType } from "@mineskin/types";
import { GeneratorError, ImageHashes } from "@mineskin/generator";
import { GenerateReqUser } from "../../validation/generate";
import { stripUuid } from "../../util";
import { Caching } from "../Caching";
import { Log } from "../../Log";
import * as Sentry from "@sentry/node";

export class V2UserHandler extends V2GenerateHandler {

    constructor(req: GenerateV2Request, res: Response<V2GenerateResponseBody | V2SkinResponse>, options: GenerateOptions) {
        super(req, res, options, GenerateType.USER);
    }

    handlesImage(): boolean {
        return false;
    }

    async getImageReference(hashes?: ImageHashes): Promise<string> {
        return await Sentry.startSpan({
            op: 'user_handler',
            name: 'getImageReference'
        }, async span => {
            let {user} = GenerateReqUser.parse(this.req.body);
            user = stripUuid(user);
            Log.l.debug(`${ this.req.breadcrumbC } USER:        "${ user }"`);
            const userValidation = await Caching.getUserByUuid(user);
            if (!userValidation || !userValidation.valid) {
                throw new GeneratorError('invalid_user', "Invalid user", {httpCode: 400, source: ErrorSource.CLIENT})
            }
            return user;
        });
    }

}