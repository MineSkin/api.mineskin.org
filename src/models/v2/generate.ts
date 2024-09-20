import { GenerateV2Request } from "../../routes/v2/types";
import * as Sentry from "@sentry/node";
import multer, { MulterError } from "multer";
import { logger } from "../../util/log";
import { Maybe } from "../../util";
import {
    DuplicateChecker,
    GenerateOptions,
    GenerateRequest,
    GenerateResult,
    GeneratorClient,
    GeneratorError,
    GenError,
    ImageService,
    ImageValidation,
    MAX_IMAGE_SIZE,
    SkinService,
    TrafficService
} from "@mineskin/generator";
import {
    ErrorSource,
    GenerateType,
    RateLimitInfo,
    SkinInfo2,
    SkinVariant,
    SkinVisibility2,
    UUID
} from "@mineskin/types";
import { IPopulatedSkin2Document, ISkinDocument, isPopulatedSkin2Document } from "@mineskin/database";
import { Response } from "express";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { debug } from "../../util/colors";
import { V2GenerateResponse } from "../../typings/v2/V2GenerateResponse";

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

export async function v2GenerateFromUpload(req: GenerateV2Request, res: Response<V2GenerateResponse | V2SkinResponse>) {

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
    req.nextRequest = await TrafficService.getNextRequest(req.client);
    req.minDelay = await TrafficService.getMinDelay(req.client, req.apiKey) * 1000;
    const now = Date.now();
    if (req.nextRequest > now) {
        //TODO: full delay response
        return res.status(429).json({
            success: false,
            rateLimit: makeRateLimitInfo(req),
            errors: [
                {
                    code: 'rate_limit',
                    message: `request too soon, next request in ${ ((Math.round(req.nextRequest - now) / 100) * 100) }ms`
                }
            ]
        });
    }

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
            return;
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
            return;
        }
    }

    logger.debug(req.body);

    const file: Maybe<Express.Multer.File> = req.file;
    if (!file) {
        res.status(500).json({
            success: false,
            errors: [
                {
                    code: 'missing_file',
                    message: `no file uploaded`
                }
            ]
        });
        return;
    }

    logger.debug(`${ req.breadcrumbC } FILE:        "${ file.filename }"`);

    // preliminary rate limiting
    req.nextRequest = await TrafficService.updateLastAndNextRequest(req.client, 200);


    const validation = await ImageValidation.validateImageBuffer(file.buffer);
    logger.debug(validation);

    //TODO: ideally don't do this here and in the generator
    if (options.variant === SkinVariant.UNKNOWN) {
        if (validation.variant === SkinVariant.UNKNOWN) {
            throw new GeneratorError(GenError.UNKNOWN_VARIANT, "Unknown variant", {
                source: ErrorSource.CLIENT,
                httpCode: 400
            });
        }
        logger.info(req.breadcrumb + " Switching unknown skin variant to " + validation.variant + " from detection");
        Sentry.setExtra("generate_detected_variant", validation.variant);
        options.variant = validation.variant;
    }


    let hashes;
    try {
        hashes = await ImageService.getImageHashes(file.buffer);
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
    logger.debug(req.breadcrumbC + " Image hash: ", hashes);

    console.log(file.buffer.byteLength);

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
            return await queryAndSendSkin(req, res, result.existing.uuid, true);
        }
        // otherwise, continue with generator
    }

    /*
    const duplicateResult = await DuplicateChecker.findDuplicateDataFromImageHash(hashes, options.variant, GenerateType.UPLOAD, req.breadcrumb || "????");
    logger.debug(JSON.stringify(duplicateResult, null, 2));
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

    const imageUploaded = await client.insertUploadedImage(hashes.minecraft, file.buffer);

    const request: GenerateRequest = {
        breadcrumb: req.breadcrumb || "????",
        type: GenerateType.UPLOAD,
        image: hashes.minecraft,
        options: options,
        client: req.client
    }
    logger.debug(request);
    const job = await client.submitRequest(request);
    try {
        const result = await job.waitUntilFinished(client.queueEvents, 10_000) as GenerateResult; //TODO: configure timeout
        return await queryAndSendSkin(req, res, result.skin);
    } catch (e) {
        console.warn(e);
        if (e.message.includes('timed out before finishing')) { // this kinda sucks
            return res.status(500).json({
                success: false,
                rateLimit: makeRateLimitInfo(req),
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
        rateLimit: makeRateLimitInfo(req),
        errors: [
            {
                code: 'unexpected_error',
                message: `unexpected error`
            }
        ]
    });
}

async function queryAndSendSkin(req: GenerateV2Request, res: Response, uuid: UUID, duplicate: boolean = false) {
    const skin = await SkinService.findForUuid(uuid);
    if (!skin || !isPopulatedSkin2Document(skin) || !skin.data) {
        return res.status(500).json({
            success: false,
            errors: [
                {
                    code: 'skin_not_found',
                    message: `skin not found`
                }
            ]
        });
    }

    //TODO: proper response
    return res.json({
        success: true,
        skin: skinToJson(skin, duplicate),
        rateLimit: makeRateLimitInfo(req)
    });
}

function makeRateLimitInfo(req: GenerateV2Request): RateLimitInfo {
    const now = Date.now();
    return {
        next: {
            absolute: req.nextRequest || now,
            relative: Math.max(0, (req.nextRequest || now) - now)
        },
        delay: {
            millis: req.minDelay || 0,
            seconds: req.minDelay ? req.minDelay / 1000 : 0
        }
    };
}

function isV1SkinDocument(skin: any): skin is ISkinDocument {
    return 'skinUuid' in skin || 'minecraftTextureHash' in skin;
}

function v1SkinToV2Json(skin: ISkinDocument, duplicate: boolean = false): SkinInfo2 {
    return {
        uuid: skin.skinUuid || skin.uuid,
        name: skin.name,
        visibility: skin.visibility == 2 ? SkinVisibility2.PRIVATE : skin.visibility == 1 ? SkinVisibility2.UNLISTED : SkinVisibility2.PUBLIC,
        variant: skin.variant,
        texture: {
            data: {
                value: skin.value,
                signature: skin.signature
            },
            hash: {
                skin: skin.minecraftTextureHash || skin.hash
            },
            url: {
                skin: skin.url
            }
        },
        generator: {
            timestamp: skin.time,
            account: `${ skin.account }`,
            server: skin.server || 'unknown',
            worker: 'none',
            version: 'unknown',
            duration: 0
        },
        views: skin.views,
        duplicate: duplicate
    };
}

const MC_TEXTURE_PREFIX = "https://textures.minecraft.net/texture/";

function skinToJson(skin: IPopulatedSkin2Document, duplicate: boolean = false): SkinInfo2 {
    if (!skin.data) {
        throw new Error("Skin data is missing");
    }
    logger.debug(JSON.stringify(skin.data, null, 2));
    return {
        uuid: skin.uuid,
        name: skin.meta.name,
        visibility: skin.meta.visibility,
        variant: skin.meta.variant,
        texture: {
            data: {
                value: skin.data.value,
                signature: skin.data.signature
            },
            hash: {
                skin: skin.data.hash?.skin.minecraft,
                cape: skin.data.hash?.cape?.minecraft
            },
            url: {
                skin: MC_TEXTURE_PREFIX + skin.data.hash?.skin.minecraft,
                cape: skin.data.hash?.cape?.minecraft ? (MC_TEXTURE_PREFIX + skin.data.hash?.cape?.minecraft) : undefined
            }
        },
        generator: {
            timestamp: skin.data.createdAt.getTime(),
            account: skin.data.generatedBy.account,
            server: skin.data.generatedBy.server,
            worker: skin.data.generatedBy.worker,
            version: 'unknown', //TODO
            duration: 0 //TODO
        },
        views: skin.views,
        duplicate: duplicate
    };
}

function getAndValidateOptions(req: GenerateV2Request, res: Response): GenerateOptions {
    return Sentry.startSpan({
        op: "v2_generate_getAndValidateOptions",
        name: "getAndValidateOptions"
    }, (span) => {
        const variant = validateVariant(req.body["variant"] || req.query["variant"]);
        const visibility = validateVisibility(req.body["visibility"] || req.query["visibility"]);
        const name = validateName(req.body["name"] || req.query["name"]);

        const checkOnly = !!(req.body["checkOnly"] || req.query["checkOnly"]); //TODO: implement this


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
            variant,
            visibility,
            name
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
