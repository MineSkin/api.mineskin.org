import { V2GenerateHandler } from "./V2GenerateHandler";
import { GenerateV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { V2GenerateResponseBody } from "../../typings/v2/V2GenerateResponseBody";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { GenerateOptions, GenerateType } from "@mineskin/types";
import { ImageHashes } from "@mineskin/generator";

export class V2UserHandler extends V2GenerateHandler{

    constructor(req: GenerateV2Request, res: Response<V2GenerateResponseBody | V2SkinResponse>, options: GenerateOptions) {
        super(req, res, options, GenerateType.USER);
    }

    handlesImage(): boolean {
        return false;
    }

    getImageReference(hashes?: ImageHashes): string {
        return this.req.body.user!;
    }

}