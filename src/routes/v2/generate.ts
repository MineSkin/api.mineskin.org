import { GeneratorError, GenError, MAX_IMAGE_SIZE } from "../../generator/Generator";
import { Maybe } from "../../util";
import multer, { MulterError } from "multer";
import { Application, Response } from "express";
import { GenerateV2Request } from "./types";
import * as Sentry from "@sentry/node";
import { debug } from "../../util/colors";
import { SkinVariant, SkinVisibility2 } from "@mineskin/types";
import { GenerateOptions, GenerateRequest, GeneratorClient, ImageService } from "@mineskin/generator";
import { logger } from "../../util/log";

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
    // app.use("/generate", async (req: MineSkinRequest, res, next) => {
    //     try {
    //         const key = await getAndValidateRequestApiKey(req);
    //         const delay = await Generator.getDelay(key);
    //         req.delayInfo = delay;
    //         res.header("X-MineSkin-Delay", `${ delay.seconds || 5 }`); //deprecated
    //         res.header("X-MineSkin-Delay-Seconds", `${ delay.seconds || 5 }`);
    //         res.header("X-MineSkin-Delay-Millis", `${ delay.millis || 5000 }`);
    //         next();
    //     } catch (e) {
    //         next(e);
    //     }
    // })


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

        const file: Maybe<Express.Multer.File> = req.file;
        if (!file) {
            res.status(400).json({error: "no file uploaded"});
            return;
        }

        logger.debug(client)

        logger.debug(file);

        logger.debug(`${ req.breadcrumb } FILE:        "${ file.filename }"`);

        // let   tempFile = await Temp.file({
        //     dir: UPL_DIR
        // });
        // await Temp.copyUploadedImage(file, tempFile);
        //
        // console.log(tempFile.path)
        // const imageBuffer = await fs.readFile(tempFile.path);
        // console.log(imageBuffer.byteLength);

        //TODO: validate file

        let hashes;
        try {
            hashes = await ImageService.getImageHashes(file.buffer);
        } catch (e) {
            // span?.setStatus({
            //     code: 2,
            //     message: "invalid_argument"
            // });
            throw new GeneratorError(GenError.INVALID_IMAGE, `Failed to get image hash: ${ e.message }`, 400, undefined, e);
        }
        logger.debug(req.breadcrumb + " Image hash: ", hashes);

        const imageUploaded = await client.insertUploadedImage(hashes.minecraft, file.buffer);

        const request: GenerateRequest = {
            breadcrumb: req.breadcrumb || "????",
            image: hashes.minecraft,
            options: options,
            client: { //FIXME
                date: new Date(),
                agent:"unknown",
                ip:"unknown"
            }
        }
        logger.debug(request);
        await client.submitRequest(request);

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

            const breadcrumb = req.breadcrumb;

            // console.log(debug(`${ breadcrumb } Type:        ${ type }`))
            console.log(debug(`${ breadcrumb } Variant:     ${ variant }`));
            console.log(debug(`${ breadcrumb } Visibility:  ${ visibility }`));
            console.log(debug(`${ breadcrumb } Name:        "${ name ?? '' }"`));
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