import { BufferResult, V2GenerateHandler } from "./V2GenerateHandler";
import { GenerateV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { V2GenerateResponseBody } from "../../typings/v2/V2GenerateResponseBody";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { GenerateOptions, GenerateType } from "@mineskin/types";
import { GenerateReqUrlBase64 } from "../../validation/generate";
import { Temp, URL_DIR } from "../Temp";
import * as fs from "node:fs";
import { Readable } from "stream";
import { readFile } from "fs/promises";
import { Log } from "../../Log";
import * as Sentry from "@sentry/node";
import { isTempFile, PathHolder } from "../../util";
import ExifTransformer from "exif-be-gone/index";

export class V2Base64Handler extends V2GenerateHandler {

    tempFile: PathHolder | undefined;

    constructor(req: GenerateV2Request, res: Response<V2GenerateResponseBody | V2SkinResponse>, options: GenerateOptions) {
        super(req, res, options, GenerateType.URL);
    }

    async getImageBuffer(): Promise<BufferResult> {
        return await Sentry.startSpan({
            op: 'base64_handler',
            name: 'getImageBuffer'
        }, async span => {
            const {url: base64Url} = GenerateReqUrlBase64.parse(this.req.body);
            Log.l.debug(`${ this.req.breadcrumbC } URL:         "${ base64Url.substring(15, 32) }...${ base64Url.substring(base64Url.length - 16) }"`);

            this.tempFile = await Temp.file({
                dir: URL_DIR
            });

            // read the base64 data
            const base64Data = base64Url.replace(/^data:image\/png;base64,/, "");
            const tempBuffer = Buffer.from(base64Data, 'base64');

            // strip metadata and write the buffer to the temp file
            await new Promise((resolve, reject) => {
                Readable.from(tempBuffer)
                    .pipe(new ExifTransformer()) // strip metadata
                    .pipe(fs.createWriteStream(this.tempFile!.path))
                    .on('finish', resolve)
                    .on('error', reject);
            });
            Log.l.debug(`saved base64 image to temp file: ${ this.tempFile.path }`);

            const buffer = await readFile(this.tempFile.path);
            return {buffer};
        });
    }

    cleanupImage() {
        if (isTempFile(this.tempFile)) {
            this.tempFile.remove();
        }
    }

}