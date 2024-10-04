import { GenerateV2Request } from "../../routes/v2/types";
import * as Sentry from "@sentry/node";
import multer, { MulterError } from "multer";
import { Maybe } from "../../util";
import {
    BillingService,
    DuplicateChecker,
    GenerateOptions,
    GenerateRequest,
    GenerateResult,
    GeneratorClient,
    GeneratorError,
    GenError,
    ImageService,
    ImageValidation,
    Log,
    MAX_IMAGE_SIZE,
    TrafficService
} from "@mineskin/generator";
import { ErrorSource, GenerateType, isBillableClient, SkinVariant, SkinVisibility2 } from "@mineskin/types";
import { Response } from "express";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { debug } from "../../util/colors";
import { V2GenerateResponseBody } from "../../typings/v2/V2GenerateResponseBody";
import { GenerateReqOptions, GenerateReqUser } from "../../runtype/GenerateReq";
import { V2GenerateHandler } from "../../generator/v2/V2GenerateHandler";
import { V2UploadHandler } from "../../generator/v2/V2UploadHandler";
import { V2UrlHandler } from "../../generator/v2/V2UrlHandler";

const upload = multer({
    limits: {
        fileSize: MAX_IMAGE_SIZE,
        files: 1,
        fields: 5
    }
});

const client = new GeneratorClient({
    connection: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT!)
    },
    blockingConnection: false
});

export async function v2GenerateFromUpload(req: GenerateV2Request, res: Response<V2GenerateResponseBody | V2SkinResponse>) {

    // need to call multer stuff first so fields are parsed
    if (req.is('multipart/form-data')) {
        const fileUploaded = await tryHandleFileUpload(req, res);
        if (!fileUploaded) {
            return;
        }
    } else {
        upload.none();
    }

    const options = getAndValidateOptions(req, res);
    //const client = getClientInfo(req);
    if (!req.client) {
        res.status(500).json({
            success: false,
            errors: [
                {
                    code: 'invalid_client',
                    message: `no client info`
                }
            ]
        });
        return;
    }

    // check rate limit
    const trafficService = TrafficService.getInstance();
    req.nextRequest = await trafficService.getNextRequest(req.client);
    req.minDelay = await trafficService.getMinDelaySeconds(req.client, req.apiKey) * 1000;
    if (req.nextRequest > req.client.time) {
        return res.status(429).json({
            success: false,
            rateLimit: V2GenerateHandler.makeRateLimitInfo(req),
            errors: [
                {
                    code: 'rate_limit',
                    message: `request too soon, next request in ${ ((Math.round(req.nextRequest - Date.now()) / 100) * 100) }ms`
                }
            ]
        });
    }

    Log.l.debug(req.client)

    // check credits
    if (isBillableClient(req.client)) {
        const billingService = BillingService.getInstance();
        if (req.client.credits) {
            const credit = await billingService.getClientCredits(req.client);
            if (!credit) {
                return res.status(400).json({
                    success: false,
                    errors: [
                        {
                            code: 'no_credits',
                            message: `no credits`
                        }
                    ]
                });
            }
            if (!credit.isValid()) {
                return res.status(400).json({
                    success: false,
                    errors: [
                        {
                            code: 'invalid_credits',
                            message: `invalid credits`
                        }
                    ]
                });
            }
            if (credit.balance <= 0) {
                return res.status(429).json({
                    success: false,
                    rateLimit: V2GenerateHandler.makeRateLimitInfo(req),
                    errors: [
                        {
                            code: 'insufficient_credits',
                            message: `insufficient credits`
                        }
                    ]
                });
            }
            res.header('X-MineSkin-Credits-Type', credit.type);
            res.header('X-MineSkin-Credits-Balance', `${ credit.balance }`);
        }
    }

    Log.l.debug(req.body);

    let handler: V2GenerateHandler;

    if (req.is('multipart/form-data')) {
        handler = new V2UploadHandler(req, res, options);
    } else if (req.is('application/json')) {
        console.debug('application/json') //TODO: remove
        if ('url' in req.body) {
            handler = new V2UrlHandler(req, res, options);
        } else if ('user' in req.body) {
            const {uuid} = GenerateReqUser.check(req.body);
            Log.l.debug(`${ req.breadcrumbC } USER:        "${ uuid }"`);
            //TODO
            throw new Error("User generation is currently not supported");
        } else {
            return res.status(400).json({
                success: false,
                errors: [
                    {
                        code: 'invalid_request',
                        message: `invalid request properties (expected url or user)`
                    }
                ]
            });
        }
    } else {
        return res.status(400).json({
            success: false,
            errors: [
                {
                    code: 'invalid_content_type',
                    message: `invalid content type: ${ req.header('content-type') } (expected multipart/form-data or application/json)`
                }
            ]
        });
    }

    // preliminary rate limiting
    req.nextRequest = await trafficService.updateLastAndNextRequest(req.client, 200);
    Log.l.debug(`next request at ${ req.nextRequest }`);

    const imageResult = await handler.getImageBuffer();
    if (imageResult.existing) {
        return await handler.queryAndSendSkin(req, res, imageResult.existing, true);
    }
    const imageBuffer = imageResult.buffer;
    if (!imageBuffer) {
        throw new GeneratorError(GenError.INVALID_IMAGE, "Failed to get image buffer", {httpCode: 500});
    }


    const validation = await ImageValidation.validateImageBuffer(imageBuffer);
    Log.l.debug(validation);

    //TODO: ideally don't do this here and in the generator
    if (options.variant === SkinVariant.UNKNOWN) {
        if (validation.variant === SkinVariant.UNKNOWN) {
            throw new GeneratorError(GenError.UNKNOWN_VARIANT, "Unknown variant", {
                source: ErrorSource.CLIENT,
                httpCode: 400
            });
        }
        Log.l.info(req.breadcrumb + " Switching unknown skin variant to " + validation.variant + " from detection");
        Sentry.setExtra("generate_detected_variant", validation.variant);
        options.variant = validation.variant;
    }


    let hashes;
    try {
        hashes = await ImageService.getImageHashes(imageBuffer);
    } catch (e) {
        // span?.setStatus({
        //     code: 2,
        //     message: "invalid_argument"
        // });
        throw new GeneratorError(GenError.INVALID_IMAGE, `Failed to get image hash: ${ e.message }`, {
            httpCode: 400,
            error: e
        });
    }
    Log.l.debug(req.breadcrumbC + " Image hash: ", hashes);

    console.log(imageBuffer.byteLength);

    // duplicate check V2, same as in generator
    //  just to avoid unnecessary submissions to generator
    const duplicateV2Data = await DuplicateChecker.findDuplicateDataFromImageHash(hashes, options.variant, GenerateType.UPLOAD, req.breadcrumb || "????");
    if (duplicateV2Data.existing) {
        // found existing data
        const skinForDuplicateData = await DuplicateChecker.findV2ForData(duplicateV2Data.existing);
        const result = await DuplicateChecker.handleV2DuplicateResult({
            source: duplicateV2Data.source,
            existing: skinForDuplicateData,
            data: duplicateV2Data.existing
        }, options, req.client, req.breadcrumb || "????");
        await DuplicateChecker.handleDuplicateResultMetrics(result, GenerateType.UPLOAD, options, req.client);
        if (!!result.existing) {
            // full duplicate, return existing skin
            return await handler.queryAndSendSkin(req, res, result.existing.uuid, true);
        }
        // otherwise, continue with generator
    }

    /*
    const duplicateResult = await DuplicateChecker.findDuplicateDataFromImageHash(hashes, options.variant, GenerateType.UPLOAD, req.breadcrumb || "????");
    Log.l.debug(JSON.stringify(duplicateResult, null, 2));
    if (duplicateResult.existing && isV1SkinDocument(duplicateResult.existing)) {
        return res.json({
            success: true,
            skin: v1SkinToV2Json(duplicateResult.existing, true)
        });
    } else if (duplicateResult.existing && isPopulatedSkin2Document(duplicateResult.existing)) {
        return res.json({
            success: true,
            skin: skinToJson(duplicateResult.existing, true)
        });
    }
     */

    const imageUploaded = await client.insertUploadedImage(hashes.minecraft, imageBuffer);

    const request: GenerateRequest = {
        breadcrumb: req.breadcrumb || "????",
        type: GenerateType.UPLOAD,
        image: hashes.minecraft,
        options: options,
        client: req.client
    }
    Log.l.debug(request);
    const job = await client.submitRequest(request);
    try {
        const result = await job.waitUntilFinished(client.queueEvents, 10_000) as GenerateResult; //TODO: configure timeout
        return await handler.queryAndSendSkin(req, res, result.skin);
    } catch (e) {
        console.warn(e);
        if (e.message.includes('timed out before finishing')) { // this kinda sucks
            return res.status(500).json({
                success: false,
                rateLimit: V2GenerateHandler.makeRateLimitInfo(req),
                errors: [
                    {
                        code: 'generator_timeout',
                        message: `generator request timed out`
                    }
                ]
            });
        }
    }

    return res.status(500).json({
        success: false,
        rateLimit: V2GenerateHandler.makeRateLimitInfo(req),
        errors: [
            {
                code: 'unexpected_error',
                message: `unexpected error`
            }
        ]
    });
}

function getAndValidateOptions(req: GenerateV2Request, res: Response): GenerateOptions {
    return Sentry.startSpan({
        op: "v2_generate_getAndValidateOptions",
        name: "getAndValidateOptions"
    }, (span) => {
        console.debug(req.header('content-type'))

        Log.l.debug(JSON.stringify(req.body));//TODO: remove
        let {
            variant,
            visibility,
            name
        } = GenerateReqOptions.check(req.body);

        variant = validateVariant(variant);
        visibility = validateVisibility(visibility);
        name = validateName(name);

        // const variant = validateVariant(req.body["variant"] || req.query["variant"]);
        // const visibility = validateVisibility(req.body["visibility"] || req.query["visibility"]);
        // const name = validateName(req.body["name"] || req.query["name"]);
        //
        // const checkOnly = !!(req.body["checkOnly"] || req.query["checkOnly"]); //TODO: implement this


        // console.log(debug(`${ breadcrumb } Type:        ${ type }`))
        console.log(debug(`${ req.breadcrumbC } Variant:     ${ variant }`));
        console.log(debug(`${ req.breadcrumbC } Visibility:  ${ visibility }`));
        console.log(debug(`${ req.breadcrumbC } Name:        "${ name ?? '' }"`));
        // if (checkOnly) {
        //     console.log(debug(`${ breadcrumb } Check Only:  true`));
        // }

        Sentry.setTags({
            // "generate_type": type,
            "generate_variant": variant,
            "generate_visibility": visibility
        });

        return {
            variant: variant!,
            visibility: visibility!,
            name: name
        };
    })

}

function validateVariant(variant?: string): SkinVariant {
    if (!variant || variant.length < 3) {
        return SkinVariant.UNKNOWN;
    }
    variant = variant.toLowerCase();

    if (variant === "classic" || variant === "default" || variant === "steve") {
        return SkinVariant.CLASSIC;
    }
    if (variant === "slim" || variant === "alex") {
        return SkinVariant.SLIM;
    }

    return SkinVariant.UNKNOWN;
}

function validateVisibility(visibility?: string): SkinVisibility2 {
    if (!visibility || !(visibility in ["public", "unlisted", "private"])) {
        return SkinVisibility2.PUBLIC;
    }
    return visibility as SkinVisibility2;
}

function validateName(name?: string): Maybe<string> {
    if (!name) {
        return undefined;
    }
    name = `${ name }`.substring(0, 20);
    if (name.length === 0) return undefined;
    return name;
}


async function tryHandleFileUpload(req: GenerateV2Request, res: Response): Promise<boolean> {
    try {
        await new Promise<void>((resolve, reject) => {
            upload.single('file')(req, res, function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            })
        });
        return true;
    } catch (e) {
        Sentry.captureException(e);
        if (e instanceof MulterError) {
            res.status(400).json({
                success: false,
                errors: [
                    {
                        code: e.code || 'invalid_file',
                        message: `invalid file: ${ e.message }`
                    }
                ]
            });
            return false;
        } else {
            res.status(500).json({
                success: false,
                errors: [
                    {
                        code: 'upload_error',
                        message: `upload error: ${ e.message }`
                    }
                ]
            });
            return false;
        }
    }
}



