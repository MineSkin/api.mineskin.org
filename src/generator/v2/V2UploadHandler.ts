import { BufferResult, V2GenerateHandler } from "./V2GenerateHandler";
import { Response } from "express";
import { GeneratorError, Log } from "@mineskin/generator";
import { V2GenerateResponseBody } from "../../typings/v2/V2GenerateResponseBody";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { GenerateV2Request } from "../../routes/v2/types";
import { GenerateOptions, GenerateType, Maybe } from "@mineskin/types";
import ExifTransformer from "exif-be-gone/index";
import { isTempFile, PathHolder } from "../../util";
import { Temp, UPL_DIR } from "../Temp";
import * as fs from "node:fs";
import { readFile } from "fs/promises";

export class V2UploadHandler extends V2GenerateHandler {

    tempFile: PathHolder|undefined;

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

        this.tempFile = await Temp.file({
            dir: UPL_DIR
        });

        fs.createReadStream(file.path)
            .pipe(new ExifTransformer()) // strip metadata
            .pipe(fs.createWriteStream(this.tempFile.path));

        const buffer = await readFile(this.tempFile.path);
        return {buffer};
    }

    cleanupImage() {
        if (isTempFile(this.tempFile)) {
            this.tempFile.remove();
        }
    }

}