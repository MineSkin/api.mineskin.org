import { GenerateV2Request } from "../../routes/v2/types";
import * as Sentry from "@sentry/node";
import multer, { MulterError } from "multer";
import { Maybe } from "../../util";
import {
    DuplicateChecker,
    GeneratorError,
    GenError,
    IGeneratorClient,
    ImageHashes,
    ImageService,
    ImageValidation,
    MAX_IMAGE_SIZE,
    MongoGeneratorClient,
    QueueOptions,
    SkinService,
    TrafficService,
    TYPES as GeneratorTypes
} from "@mineskin/generator";
import { BillingService, TYPES as BillingTypes } from "@mineskin/billing";
import {
    ErrorSource,
    GenerateOptions,
    GenerateRequest,
    GenerateResult,
    GenerateType,
    MineSkinError,
    SkinVariant,
    SkinVisibility2,
    UUID
} from "@mineskin/types";
import { Response } from "express";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { debug } from "../../util/colors";
import { V2GenerateResponseBody } from "../../typings/v2/V2GenerateResponseBody";
import { V2GenerateHandler } from "../../generator/v2/V2GenerateHandler";
import { V2UploadHandler } from "../../generator/v2/V2UploadHandler";
import { V2UrlHandler } from "../../generator/v2/V2UrlHandler";
import { V2JobResponse } from "../../typings/v2/V2JobResponse";
import { IPopulatedSkin2Document, IQueueDocument, isPopulatedSkin2Document } from "@mineskin/database";
import { GenerateReqOptions, GenerateTimeout } from "../../validation/generate";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { V2JobListResponse } from "../../typings/v2/V2JobListResponse";
import { ObjectId } from "../../validation/misc";
import { V2UserHandler } from "../../generator/v2/V2UserHandler";
import { container } from "../../inversify.config";
import { Log } from "../../Log";

const upload = multer({
    limits: {
        fileSize: MAX_IMAGE_SIZE,
        files: 1,
        fields: 5
    }
});

let _client: IGeneratorClient<IQueueDocument>;

function getClient() {
    if (!_client) {
        _client = container.get<IGeneratorClient<any>>(GeneratorTypes.GeneratorClient);
    }
    return _client;
}

export async function v2GenerateAndWait(req: GenerateV2Request, res: Response<V2GenerateResponseBody | V2SkinResponse>): Promise<V2GenerateResponseBody | V2SkinResponse> {
    const {skin, job} = await v2SubmitGeneratorJob(req, res);
    if (job) {
        req.links.job = `/v2/queue/${ job.id }`;
        if (job.request.image) {
            req.links.image = `/v2/images/${ job.request.image }`;
        }
    }
    if (skin) {
        req.links.skin = `/v2/skins/${ skin.id }`;
        const queried = await querySkinOrThrow(skin.id);
        return {
            success: true,
            skin: V2GenerateHandler.skinToJson(queried, skin.duplicate),
            rateLimit: V2GenerateHandler.makeRateLimitInfo(req)
        };
    }
    if (!job) {
        throw new GeneratorError('job_not_found', "Job not found", {httpCode: 404});
    }
    try {
        const timeoutSeconds = GenerateTimeout.parse(req.query.timeout);
        const result = await getClient().waitForJob(job.id, timeoutSeconds * 1000) as GenerateResult; //TODO: configure timeout
        Log.l.debug(JSON.stringify(result, null, 2));
        req.links.skin = `/v2/skins/${ result.skin }`;
        const queried = await querySkinOrThrow(result.skin);
        return {
            success: true,
            skin: V2GenerateHandler.skinToJson(queried, !!result.duplicate),
            rateLimit: V2GenerateHandler.makeRateLimitInfo(req),
            usage: result.usage
        };
    } catch (e) {
        if (e instanceof MineSkinError) {
            throw e;
        }
        if (e.message.includes('timed out before finishing') || e.message.includes('Timeout')) { // this kinda sucks
            Log.l.warn(e);
            throw new GeneratorError('generator_timeout', "generator request timed out", {httpCode: 500, error: e});
        }
        Log.l.error(e);
        Sentry.captureException(e);
        throw new GeneratorError('unexpected_error', "unexpected error", {httpCode: 500, error: e});
    }
}

export async function v2GenerateEnqueue(req: GenerateV2Request, res: Response<V2GenerateResponseBody | V2JobResponse>): Promise<V2JobResponse> {
    const {skin, job} = await v2SubmitGeneratorJob(req, res);
    if (job) {
        req.links.job = `/v2/queue/${ job.id }`;
        if (job.request.image) {
            req.links.image = `/v2/images/${ job.request.image }`;
        }
    }
    if (skin) {
        req.links.skin = `/v2/skins/${ skin.id }`;
        const queried = await querySkinOrThrow(skin.id);

        res.status(200);
        return {
            success: true,
            messages: [{
                code: 'skin_found',
                message: "Found existing skin"
            }],
            job: {
                id: job?.id || null,
                status: job?.status || 'completed',
                timestamp: job?.createdAt?.getTime() || 0,
                result: skin.id
            },
            skin: V2GenerateHandler.skinToJson(queried, skin.duplicate),
            rateLimit: V2GenerateHandler.makeRateLimitInfo(req)
        };
    }
    res.status(202);
    return {
        success: true,
        messages: [{
            code: 'job_queued',
            message: "Job queued"
        }],
        job: {
            id: job?.id || null,
            status: job?.status || 'unknown',
            timestamp: job?.createdAt?.getTime() || 0
        },
        rateLimit: V2GenerateHandler.makeRateLimitInfo(req)
    };
}

export async function v2GetJob(req: GenerateV2Request, res: Response<V2GenerateResponseBody | V2JobResponse>): Promise<V2JobResponse> {
    const jobId = ObjectId.parse(req.params.jobId);
    const job = await getClient().getJob(jobId);
    if (!job) {
        throw new GeneratorError('job_not_found', `Job not found: ${ jobId }`, {httpCode: 404});
    }

    req.links.job = `/v2/queue/${ jobId }`;
    req.links.self = req.links.job;
    req.links.image = `/v2/images/${ job.request.image }`;

    if (job.status === 'completed') {
        const result = job.result!;
        req.links.skin = `/v2/skins/${ result.skin }`;
        const queried = await querySkinOrThrow(result.skin);
        return {
            success: true,
            messages: [{
                code: 'job_completed',
                message: "Job completed"
            }],
            job: {
                id: job?.id || null,
                status: job?.status || 'completed',
                timestamp: job?.createdAt?.getTime() || 0,
                result: result.skin
            },
            skin: V2GenerateHandler.skinToJson(queried, !!result.duplicate),
            usage: result.usage
        };
    }
    if (job.status === 'failed') {
        let error: Error;
        if (job.error) {
            error = MongoGeneratorClient.deserializeCustomError(job.error);
        } else {
            error = new GeneratorError('job_failed', "Job failed", {httpCode: 500});
        }
        return {
            success: true,
            messages: [{
                code: 'job_failed',
                message: "Job failed"
            }],
            job: {
                id: job.id,
                status: job.status,
                timestamp: job.createdAt?.getTime() || 0
            },
            errors: [{
                code: 'code' in error ? error.code as string : 'unexpected_error',
                message: error.message
            }]
        };
    }
    return {
        success: true,
        messages: [{
            code: 'job_pending',
            message: "Job pending"
        }],
        job: {
            id: job?.id || null,
            status: job?.status || 'unknown',
            timestamp: job?.createdAt?.getTime() || 0
        }
    };
}

export async function v2ListJobs(req: GenerateV2Request, res: Response<V2MiscResponseBody>): Promise<V2JobListResponse> {
    let jobs;
    if (req.client.hasApiKey()) {
        jobs = await getClient().getByApiKey(req.client.apiKeyId!);
    } else if (req.client.hasUser()) {
        jobs = await getClient().getByUser(req.client.userId!);
    } else {
        throw new GeneratorError('unauthorized', "no client info", {httpCode: 401});
    }

    const threeHoursAgo = new Date();
    threeHoursAgo.setHours(threeHoursAgo.getHours() - 3);

    return {
        success: true,
        jobs: jobs
            .filter(j => j.createdAt > threeHoursAgo)
            .map(job => {
                return {
                    id: job.id,
                    status: job.status,
                    timestamp: job?.createdAt?.getTime() || 0,
                    result: job.result?.skin
                }
            })
    };
}

//TODO: track stats

async function v2SubmitGeneratorJob(req: GenerateV2Request, res: Response<V2GenerateResponseBody | V2SkinResponse>): Promise<JobWithSkin> {

    // need to call multer stuff first so fields are parsed
    if (!(req as any)._uploadProcessed) { //TODO: remove
        if (req.is('multipart/form-data')) {
            await tryHandleFileUpload(req, res);
        } else {
            upload.none();
        }
    }

    const options = getAndValidateOptions(req);
    //const client = getClientInfo(req);
    if (!req.clientInfo) {
        throw new GeneratorError('invalid_client', "no client info", {httpCode: 500});
    }

    // // check rate limit
    const trafficService = container.get<TrafficService>(GeneratorTypes.TrafficService);
    // req.nextRequest = await trafficService.getNextRequest(req.clientInfo);
    // req.minDelay = await trafficService.getMinDelaySeconds(req.clientInfo, req.apiKey) * 1000;
    // if (req.nextRequest > req.clientInfo.time) {
    //     throw new GeneratorError('rate_limit', `request too soon, next request in ${ ((Math.round(req.nextRequest - Date.now()) / 100) * 100) }ms`, {httpCode: 429});
    // }

    // // check credits
    // // (always check, even when not enabled, to handle free credits)
    // if (req.client.canUseCredits()) {
    //     const billingService = BillingService.getInstance();
    //     const credit = await billingService.getClientCredits(req.clientInfo);
    //     if (!credit) {
    //         req.warnings.push({
    //             code: 'no_credits',
    //             message: "no credits"
    //         });
    //         req.clientInfo.credits = false;
    //     } else {
    //         if (!credit.isValid()) {
    //             req.warnings.push({
    //                 code: 'invalid_credits',
    //                 message: "invalid credits"
    //             });
    //             req.clientInfo.credits = false;
    //         } else if (credit.balance <= 0) {
    //             req.warnings.push({
    //                 code: 'insufficient_credits',
    //                 message: "insufficient credits"
    //             });
    //             req.clientInfo.credits = false;
    //         }
    //         res.header('MineSkin-Credits-Type', credit.type);
    //         res.header('MineSkin-Credits-Balance', `${ credit.balance }`);
    //     }
    // }

    /*
    if (!req.apiKey && !req.client.hasUser()) {
        throw new GeneratorError('unauthorized', "API key or user required", {httpCode: 401});
    }*/

    if (req.client.hasUser()) {
        const pendingByUser = await getClient().getPendingCountByUser(req.client.userId!)
        if (pendingByUser > 5) { // TODO: configurable / client grant
            throw new GeneratorError('job_limit', "You have too many jobs in the queue", {httpCode: 429});
        }
    } else {
        const pendingByIp = await getClient().getPendingCountByIp(req.client.ip!)
        if (pendingByIp > 5) { // TODO: configurable / client grant
            throw new GeneratorError('job_limit', "You have too many jobs in the queue", {httpCode: 429});
        }
    }

    if (options.visibility === SkinVisibility2.PRIVATE) {
        if (!req.apiKey && !req.client.hasUser()) {
            throw new GeneratorError('unauthorized', "private skins require an API key or User", {httpCode: 401});
        }
        if (!req.client.grants?.private_skins) {
            throw new GeneratorError('insufficient_grants', "you are not allowed to generate private skins", {httpCode: 403});
        }
        Log.l.debug(`${ req.breadcrumbC } generating private`);
    }

    let handler: V2GenerateHandler;

    //TODO: support base64
    if (req.is('multipart/form-data')) {
        handler = new V2UploadHandler(req, res, options);
    } else if (req.is('application/json')) {
        console.debug('application/json') //TODO: remove
        if ('url' in req.body) {
            handler = new V2UrlHandler(req, res, options);
        } else if ('user' in req.body) {
            //TODO: validate user
            handler = new V2UserHandler(req, res, options);
        } else {
            throw new GeneratorError('invalid_request', `invalid request properties (expected url or user)`, {httpCode: 400});
        }
    } else {
        throw new GeneratorError('invalid_content_type', `invalid content type: ${ req.header('content-type') } (expected multipart/form-data or application/json)`, {httpCode: 400});
    }

    // preliminary rate limiting
    if (req.client.useDelayRateLimit()) {
        req.nextRequest = await trafficService.updateLastAndNextRequest(req.clientInfo, 200);
        Log.l.debug(`next request at ${ req.nextRequest }`);
    }
    if (req.client.usePerMinuteRateLimit()) {
        req.requestsThisMinute = (req.requestsThisMinute || 0) + 1;
        await trafficService.incRequest(req.clientInfo);
    }

    let hashes: Maybe<ImageHashes> = undefined;
    if (handler.handlesImage()) {
        const imageResult = await handler.getImageBuffer();
        if (imageResult.existing) {
            // await V2GenerateHandler.queryAndSendSkin(req, res, imageResult.existing, true);
            return {
                skin: {
                    id: imageResult.existing,
                    duplicate: true
                }
            };
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


        try {
            const imageService = container.get<ImageService>(GeneratorTypes.ImageService);
            hashes = await imageService.getImageHashes(imageBuffer, validation.dimensions.width || 64, validation.dimensions.height || 64);
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
            }, options, req.clientInfo, req.breadcrumb || "????");
            await DuplicateChecker.handleDuplicateResultMetrics(result, GenerateType.UPLOAD, options, req.clientInfo);
            if (!!result.existing) {
                // full duplicate, return existing skin
                //await V2GenerateHandler.queryAndSendSkin(req, res, result.existing.uuid, true);
                return {
                    skin: {
                        id: result.existing.uuid,
                        duplicate: true
                    }
                };
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

        const imageUploaded = await getClient().insertUploadedImage(hashes.minecraft, imageBuffer);
    } else if (handler.type === GenerateType.USER) {
        //TODO: check for recent requests on the same user and return duplicate
    }

    handler.cleanupImage();

    if (req.client.useConcurrencyLimit()) {
        await trafficService.incrementConcurrent(req.clientInfo);
        req.concurrentRequests = (req.concurrentRequests || 0) + 1;
    }

    const billingService = container.get<BillingService>(BillingTypes.BillingService);
    await billingService.trackGenerateRequest(req.clientInfo);

    const request: GenerateRequest = {
        breadcrumb: req.breadcrumb || "????",
        type: handler.type,
        image: await handler.getImageReference(hashes),
        options: options,
        clientInfo: req.clientInfo
    }
    const queueOptions: QueueOptions = {
        priority: req.client.getPriority()
    };
    const job = await getClient().submitRequest(request, queueOptions);
    return {job};
}

function getAndValidateOptions(req: GenerateV2Request): GenerateOptions {
    return Sentry.startSpan({
        op: "v2_generate_getAndValidateOptions",
        name: "getAndValidateOptions"
    }, (span) => {
        console.debug(req.header('content-type'))

        const {
            variant,
            visibility,
            name
        } = GenerateReqOptions.parse(req.body);
        //
        // variant = validateVariant(variant);
        // visibility = validateVisibility(visibility);
        // name = validateName(name);

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
            name: name?.trim()
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


async function tryHandleFileUpload(req: GenerateV2Request, res: Response): Promise<void> {
    try {
        return await new Promise<void>((resolve, reject) => {
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
            throw new GeneratorError('invalid_file', `invalid file: ${ e.message }`, {httpCode: 400, error: e});
        } else {
            throw new GeneratorError('upload_error', `upload error: ${ e.message }`, {httpCode: 500, error: e});
        }
    }
}

async function querySkinOrThrow(uuid: UUID): Promise<IPopulatedSkin2Document> {
    const skin = await container.get<SkinService>(GeneratorTypes.SkinService).findForUuid(uuid);
    if (!skin || !isPopulatedSkin2Document(skin) || !skin.data) {
        throw new GeneratorError('skin_not_found', `Skin not found: ${ uuid }`, {httpCode: 404});
    }
    return skin;
}

interface JobWithSkin {
    job?: IQueueDocument;
    skin?: {
        id: UUID;
        duplicate?: boolean;
    };
}
