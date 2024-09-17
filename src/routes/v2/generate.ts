import { Maybe } from "../../util";
import multer, { MulterError } from "multer";
import { Application, Response } from "express";
import { GenerateV2Request } from "./types";
import * as Sentry from "@sentry/node";
import { debug } from "../../util/colors";
import { GenerateType, SkinVariant, SkinVisibility2 } from "@mineskin/types";
import {
    GenerateOptions,
    GenerateRequest,
    GenerateResult,
    GeneratorClient,
    GeneratorError,
    GenError,
    ImageService,
    MAX_IMAGE_SIZE,
    SkinService
} from "@mineskin/generator";
import { logger } from "../../util/log";
import { apiKeyMiddleware } from "../../middleware/apikey";
import { mineskinClientMiddleware } from "../../middleware/client";
import { breadcrumbMiddleware } from "../../middleware/breadcrumb";

export const register = (app: Application) => {

    const upload = multer({
        limits: {
            fileSize: MAX_IMAGE_SIZE,
            files: 1,
            fields: 5
        }
    })

    const client = new GeneratorClient({
        connection: {
            host: process.env.REDIS_HOST,
            port: parseInt(process.env.REDIS_PORT!)
        },
        blockingConnection: false
    })

    // app.use("/v2/generate", corsWithAuthMiddleware);
    // app.use("/generate", (req: GenerateRequest, res: Response, next) => {
    //     addBreadcrumb(req, res);
    //     next();
    // });
    // app.use("/generate", generateLimiter);
    // app.use("/v2/generate", async (req: MineSkinV2Request, res, next) => {
    //     try {
    //         const key = await getAndValidateRequestApiKey(req);
    //         const delay = await GeneratorV1.getDelay(key);
    //         req.delayInfo = delay;
    //         res.header("X-MineSkin-Delay-Millis", `${ delay.millis || 5000 }`);
    //         next();
    //     } catch (e) {
    //         next(e);
    //     }
    // })

    app.use("/v2/generate", breadcrumbMiddleware);
    app.use("/v2/generate", apiKeyMiddleware);
    app.use("/v2/generate", mineskinClientMiddleware);


    app.post("/v2/generate/upload", async (req: GenerateV2Request, res: Response) => {
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
                res.status(400).json({error: `invalid file: ${ e.message } (${ e.code })`});
                return;
            } else {
                res.status(500).json({error: "upload error"});
                return;
            }
        }

        logger.debug(req.body);

        const options = getAndValidateOptions(req, res);
        //const client = getClientInfo(req);
        if (!req.client) {
            res.status(500).json({error: "no client info"});
            return;
        }

        const file: Maybe<Express.Multer.File> = req.file;
        if (!file) {
            res.status(400).json({error: "no file uploaded"});
            return;
        }

        logger.debug(client)

        logger.debug(file);

        logger.debug(`${ req.breadcrumbC } FILE:        "${ file.filename }"`);

        // let   tempFile = await Temp.file({
        //     dir: UPL_DIR
        // });
        // await Temp.copyUploadedImage(file, tempFile);
        //
        // console.log(tempFile.path)
        // const imageBuffer = await fs.readFile(tempFile.path);
        // console.log(imageBuffer.byteLength);

        //TODO: validate file

        //TODO: check duplicates

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
        const result = await job.waitUntilFinished(client.queueEvents,10_000) as GenerateResult;

        const skin = await SkinService.findForUuid(result.skin);

        //TODO: proper response
        return res.json({
            skin: skin
        });
    });

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


};