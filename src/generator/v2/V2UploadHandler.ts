import { BufferResult, V2GenerateHandler } from "./V2GenerateHandler";
import { Response } from "express";
import { GenerateOptions, GeneratorError, Log } from "@mineskin/generator";
import { V2GenerateResponseBody } from "../../typings/v2/V2GenerateResponseBody";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { GenerateV2Request } from "../../routes/v2/types";
import { GenerateType, Maybe } from "@mineskin/types";

export class V2UploadHandler extends V2GenerateHandler {

    constructor(req: GenerateV2Request, res: Response<V2GenerateResponseBody | V2SkinResponse>, options: GenerateOptions) {
        super(req, res, options, GenerateType.UPLOAD);
    }

    async getImageBuffer(): Promise<BufferResult> {
        const file: Maybe<Express.Multer.File> = this.req.file;
        if (!file) {
            throw new GeneratorError('missing_file', "No file uploaded", {
                httpCode: 500
            });
        }

        Log.l.debug(`${ this.req.breadcrumbC } FILE:        "${ file.filename || file.originalname }"`);

        return {buffer: file.buffer};
    }

}