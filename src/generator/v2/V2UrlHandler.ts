import { BufferResult, V2GenerateHandler } from "./V2GenerateHandler";
import { Response } from "express";
import {
    ALLOWED_IMAGE_TYPES,
    DuplicateChecker,
    GenerateOptions,
    GeneratorError,
    GenError,
    Log,
    MAX_IMAGE_SIZE
} from "@mineskin/generator";
import { GenerateType, UUID } from "@mineskin/types";
import { readFile } from "fs/promises";
import { GenerateV2Request } from "../../routes/v2/types";
import { V2GenerateResponseBody } from "../../typings/v2/V2GenerateResponseBody";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { GenerateReqUrl } from "../../runtype/GenerateReq";
import { PathHolder } from "../../util";
import { Temp, URL_DIR } from "../Temp";
import { UrlHandler } from "./UrlHandler";

export class V2UrlHandler extends V2GenerateHandler {


    constructor(req: GenerateV2Request, res: Response<V2GenerateResponseBody | V2SkinResponse>, options: GenerateOptions) {
        super(req, res, options);
    }

    async getImageBuffer(): Promise<BufferResult> {
        const {url: originalUrl} = GenerateReqUrl.check(this.req.body);
        Log.l.debug(`${ this.req.breadcrumbC } URL:         "${ originalUrl }"`);

        // check for duplicate texture or mineskin url
        const originalDuplicateCheck = await this.checkDuplicateUrl(this.req, originalUrl, this.options);
        if (originalDuplicateCheck) {
            return {existing: originalDuplicateCheck};
        }

        // fix user errors
        const rewrittenUrl = UrlHandler.rewriteUrl(originalUrl, this.req.breadcrumb || "????");

        // try to find the source image
        const followResponse = await UrlHandler.followUrl(rewrittenUrl, this.req.breadcrumb || "????");
        if (!followResponse || typeof followResponse === 'string') {
            throw new GeneratorError(GenError.INVALID_IMAGE_URL,
                "Failed to find image from url" + (typeof followResponse === 'string' ? ": " + followResponse : ""),
                {httpCode: 400, details: originalUrl});
        }
        // validate response headers
        const followedUrl = UrlHandler.getUrlFromResponse(followResponse, originalUrl);
        if (!followedUrl) {
            throw new GeneratorError(GenError.INVALID_IMAGE_URL, "Failed to follow url", {
                httpCode: 400,
                details: originalUrl
            });
        }
        // Check for duplicate from url again, if the followed url is different
        if (followedUrl !== originalUrl) {
            const followedUrlDuplicate = await this.checkDuplicateUrl(this.req, followedUrl, this.options);
            if (followedUrlDuplicate) {
                return {existing: followedUrlDuplicate};
            }
        }

        // validate response
        Log.l.debug(`${ this.req.breadcrumbC } Followed URL: "${ followedUrl }"`);
        const contentType = UrlHandler.getContentTypeFromResponse(followResponse);
        Log.l.debug(`${ this.req.breadcrumbC } Content-Type: "${ contentType }"`);
        if (!contentType || !contentType.startsWith("image") || !ALLOWED_IMAGE_TYPES.includes(contentType)) {
            throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image content type: " + contentType, {
                httpCode: 400,
                details: originalUrl
            });
        }
        const size = UrlHandler.getSizeFromResponse(followResponse);
        Log.l.debug(`${ this.req.breadcrumbC } Content-Length: ${ size }`);
        if (!size || size < 100 || size > MAX_IMAGE_SIZE) {
            throw new GeneratorError(GenError.INVALID_IMAGE, "Invalid image file size: " + size, {
                httpCode: 400
            });
        }


        // Download the image temporarily
        let tempFile: PathHolder = await Temp.file({
            dir: URL_DIR
        });
        try {
            tempFile = await Temp.downloadImage(followedUrl, tempFile)
        } catch (e) {
            throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to download image", {httpCode: 500});
        }

        const buffer = await readFile(tempFile.path);
        return {buffer};
    }

    async checkDuplicateUrl(req: GenerateV2Request, url: string, options: GenerateOptions): Promise<UUID | false> {
        const originalUrlV2Duplicate = await DuplicateChecker.findDuplicateV2FromUrl(url, options, req.breadcrumb || "????");
        if (originalUrlV2Duplicate.existing) {
            // found existing
            const result = await DuplicateChecker.handleV2DuplicateResult({
                source: originalUrlV2Duplicate.source,
                existing: originalUrlV2Duplicate.existing,
                data: originalUrlV2Duplicate.existing.data
            }, options, req.client!, req.breadcrumb || "????");
            await DuplicateChecker.handleDuplicateResultMetrics(result, GenerateType.URL, options, req.client!);
            if (!!result.existing) {
                // full duplicate, return existing skin
                // return await V2GenerateHandler.queryAndSendSkin(req, res, result.existing.uuid, true);
                return result.existing.uuid;
            }
            // otherwise, continue with generator
        }
        return false;
    }

}