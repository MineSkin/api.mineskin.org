import { BufferResult, V2GenerateHandler } from "./V2GenerateHandler";
import { Response } from "express";
import { ALLOWED_IMAGE_TYPES, DuplicateChecker, GeneratorError, GenError, MAX_IMAGE_SIZE } from "@mineskin/generator";
import { ErrorSource, GenerateOptions, GenerateType, UUID } from "@mineskin/types";
import { readFile } from "fs/promises";
import { GenerateV2Request } from "../../routes/v2/types";
import { V2GenerateResponseBody } from "../../typings/v2/V2GenerateResponseBody";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { isTempFile, PathHolder } from "../../util";
import { Temp, URL_DIR } from "../Temp";
import { UrlHandler } from "./UrlHandler";
import { GenerateReqUrl } from "../../validation/generate";
import { Log } from "../../Log";
import { UrlChecks } from "./UrlChecks";
import { container } from "../../inversify.config";
import { TYPES as GeneratorTypes } from "@mineskin/generator/dist/ditypes";
import * as Sentry from "@sentry/node";

export class V2UrlHandler extends V2GenerateHandler {

    tempFile: PathHolder | undefined;

    constructor(req: GenerateV2Request, res: Response<V2GenerateResponseBody | V2SkinResponse>, options: GenerateOptions) {
        super(req, res, options, GenerateType.URL);
    }

    async getImageBuffer(): Promise<BufferResult> {
        return await Sentry.startSpan({
            op: 'url_handler',
            name: 'getImageBuffer'
        }, async span => {
            const {url: originalUrl} = GenerateReqUrl.parse(this.req.body);
            Log.l.debug(`${ this.req.breadcrumbC } URL:         "${ originalUrl }"`);

            if (UrlChecks.isBlockedHost(originalUrl)) {
                throw new GeneratorError('blocked_url_host', "The url host is not allowed", {
                    httpCode: 400,
                    details: originalUrl,
                    source: ErrorSource.CLIENT
                });
            }

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
                if (UrlChecks.isBlockedHost(followedUrl)) {
                    throw new GeneratorError('blocked_url_host', "The followed url host is not allowed", {
                        httpCode: 400,
                        details: originalUrl
                    });
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
            this.tempFile = await Temp.file({
                dir: URL_DIR
            });
            try {
                this.tempFile = await Temp.downloadImage(followedUrl, this.tempFile)
            } catch (e) {
                throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to download image", {httpCode: 500});
            }

            // Log.l.debug(tempFile.path);
            const buffer = await readFile(this.tempFile.path);
            return {buffer};
        });
    }

    cleanupImage() {
        if (isTempFile(this.tempFile)) {
            this.tempFile.remove();
        }
    }

    async checkDuplicateUrl(req: GenerateV2Request, url: string, options: GenerateOptions): Promise<UUID | false> {
        return await Sentry.startSpan({
            op: 'url_handler',
            name: 'checkDuplicateUrl'
        }, async span => {
            const duplicateChecker = container.get<DuplicateChecker>(GeneratorTypes.DuplicateChecker);
            const originalUrlV2Duplicate = await duplicateChecker.findDuplicateV2FromUrl(url, options, req.breadcrumb || "????");
            if (originalUrlV2Duplicate.existing) {
                const isMineSkinOrTextureUrl = UrlChecks.isMineSkinUrl(url) || UrlChecks.isMinecraftTextureUrl(url);
                // found existing
                const result = await duplicateChecker.handleV2DuplicateResult(
                    {
                        source: originalUrlV2Duplicate.source,
                        existing: originalUrlV2Duplicate.existing,
                        data: originalUrlV2Duplicate.existing.data
                    },
                    options,
                    req.clientInfo!,
                    req.breadcrumb || "????",
                    isMineSkinOrTextureUrl // ignore visibility on mineskin/texture urls to return existing
                );
                await duplicateChecker.handleDuplicateResultMetrics(result, GenerateType.URL, options, req.clientInfo!);
                if (!!result.existing) {
                    // full duplicate, return existing skin
                    // return await V2GenerateHandler.queryAndSendSkin(req, res, result.existing.uuid, true);
                    return result.existing.uuid;
                }
                // otherwise, continue with generator
            }
            return false;
        });
    }

}