import { Application, Request, Response } from "express";
import {
    checkTraffic,
    corsWithAuthMiddleware,
    getAndValidateRequestApiKey,
    getIp,
    getVia,
    longAndShortUuid,
    Maybe,
    md5,
    modelToVariant,
    simplifyUserAgent,
    updateTraffic,
    validateUrl,
    variantToModel
} from "../util";
import { Generator, MAX_IMAGE_SIZE, SavedSkin } from "../generator/Generator";
import { generateLimiter } from "../util/rateLimiters";
import { ClientInfo } from "../typings/ClientInfo";
import { GenerateOptions } from "../typings/GenerateOptions";
import { GenerateType, SkinModel, SkinVariant, SkinVisibility } from "../typings/db/ISkinDocument";
import { debug } from "../util/colors";
import * as Sentry from "@sentry/node";
import { nextBreadColor } from "../typings/Bread";
import { GenerateRequest } from "../typings";
import { Caching } from "../generator/Caching";
import { isApiKeyRequest } from "../typings/ApiKeyRequest";
import { getUserFromRequest } from "./account";
import multer, { MulterError } from "multer";
import { logger } from "../util/log";

export const register = (app: Application) => {

    const upload = multer({
        dest: 'temp-uploads/',
        limits: {
            fileSize: MAX_IMAGE_SIZE,
            files: 1,
            fields: 5
        }
    })

    app.use("/generate", corsWithAuthMiddleware);
    app.use("/generate", (req: GenerateRequest, res: Response, next) => {
        addBreadcrumb(req, res);
        next();
    });
    app.use("/generate", generateLimiter);
    app.use("/generate", async (req, res, next) => {
        try {
            const delay = await Generator.getDelay(await getAndValidateRequestApiKey(req));
            res.header("X-MineSkin-Delay", `${ delay.seconds || 5 }`); //deprecated
            res.header("X-MineSkin-Delay-Seconds", `${ delay.seconds || 5 }`);
            res.header("X-MineSkin-Delay-Millis", `${ delay.millis || 5000 }`);
            next();
        } catch (e) {
            next(e);
        }
    })

    //// URL

    app.post("/generate/url", upload.none(), async (req: GenerateRequest, res: Response) => {
        const url = validateUrl(req.body["url"] || req.query["url"]);
        if (!url) {
            res.status(400).json({error: "invalid url"});
            return;
        }

        const options = getAndValidateOptions(GenerateType.URL, req, res);
        const client = getClientInfo(req);

        if (!options.checkOnly || !client.apiKey) {
            const requestAllowed = await checkTraffic(req, res);
            if (!requestAllowed) {
                return;
            }
        }

        logger.info(debug(`${ options.breadcrumb } Agent:       ${ req.headers["user-agent"] }`), {
            breadcrumb: options.breadcrumb,
            userAgent: req.headers["user-agent"]
        });
        if (req.headers['origin']) {
            logger.info(debug(`${ options.breadcrumb } Origin:      ${ req.headers['origin'] }`), {
                breadcrumb: options.breadcrumb,
                origin: req.headers['origin']
            });
        }
        console.log(debug(`${ options.breadcrumb } Key:         ${ req.apiKey?.name ?? "none" } ${ req.apiKey?._id ?? "" }`));
        console.log(debug(`${ options.breadcrumb } URL:         ${ url }`));

        if (!options.checkOnly || !client.apiKey) {
            await updateTraffic(client);
        }

        const skin = await Generator.generateFromUrlAndSave(url, options, client);
        await sendSkin(req, res, skin, client);
    })


    //// UPLOAD

    app.post("/generate/upload", async (req: GenerateRequest, res: Response) => {
        const options = getAndValidateOptions(GenerateType.UPLOAD, req, res);
        const client = getClientInfo(req);

        if (!options.checkOnly || !client.apiKey) {
            const requestAllowed = await checkTraffic(req, res);
            if (!requestAllowed) {
                return;
            }
        }

        logger.info(debug(`${ options.breadcrumb } Agent:       ${ req.headers["user-agent"] }`), {
            breadcrumb: options.breadcrumb,
            userAgent: req.headers["user-agent"]
        });
        if (req.headers['origin']) {
            logger.info(debug(`${ options.breadcrumb } Origin:      ${ req.headers['origin'] }`), {
                breadcrumb: options.breadcrumb,
                origin: req.headers['origin']
            });
        }
        console.log(debug(`${ options.breadcrumb } Key:         ${ req.apiKey?.name ?? "none" } ${ req.apiKey?._id ?? "" }`));

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

        if (!req.file) {
            res.status(400).json({error: "missing files"});
            return;
        }
        const file: Express.Multer.File = req.file;
        if (!file) {
            res.status(400).json({error: "missing file"});
            return;
        }

        console.log(debug(`${ options.breadcrumb } FILE:        "${ file.filename }"`))

        if (!options.checkOnly || !client.apiKey) {
            await updateTraffic(client);
        }

        const skin = await Generator.generateFromUploadAndSave(file, options, client);
        await sendSkin(req, res, skin, client);
    })


    //// USER

    app.post("/generate/user", upload.none(), async (req: GenerateRequest, res: Response) => {
        const uuidStr = req.body["uuid"] || req.query["uuid"];
        if (!uuidStr) {
            res.status(400).json({error: "missing uuid"});
            return;
        }

        const options = getAndValidateOptions(GenerateType.USER, req, res);
        const client = getClientInfo(req);

        const requestAllowed = await checkTraffic(req, res);
        if (!requestAllowed) {
            return;
        }
        await updateTraffic(client);
        Sentry.setTag("generate_type", GenerateType.USER);

        const uuids = longAndShortUuid(uuidStr);
        if (!uuids) {
            res.status(400).json({error: "invalid uuid"});
            return;
        }
        const userValidation = await Caching.getUserByUuid(uuids.short);
        if (!userValidation || !userValidation.valid) {
            res.status(400).json({error: "invalid user"});
            return;
        }

        logger.info(debug(`${ options.breadcrumb } Agent:       ${ req.headers["user-agent"] }`), {
            breadcrumb: options.breadcrumb,
            userAgent: req.headers["user-agent"]
        });
        if (req.headers['origin']) {
            logger.info(debug(`${ options.breadcrumb } Origin:      ${ req.headers['origin'] }`), {
                breadcrumb: options.breadcrumb,
                origin: req.headers['origin']
            });
        }
        console.log(debug(`${ options.breadcrumb } Key:         ${ req.apiKey?.name ?? "none" } ${ req.apiKey?._id ?? "" }`));
        console.log(debug(`${ options.breadcrumb } USER:        ${ uuids.long }`))

        const skin = await Generator.generateFromUserAndSave(uuids.long, options, client);
        await sendSkin(req, res, skin, client);
    })

    // TODO: remove at some point
    app.get("/generate/user/:uuid", upload.none(), async (req: GenerateRequest, res: Response) => {
        const uuidStr = req.params["uuid"];
        if (!uuidStr) {
            res.status(400).json({error: "missing uuid"});
            return;
        }

        const options = getAndValidateOptions(GenerateType.USER, req, res);
        const client = getClientInfo(req);

        const requestAllowed = await checkTraffic(req, res);
        if (!requestAllowed) {
            return;
        }
        await updateTraffic(client);
        Sentry.setTag("generate_type", GenerateType.USER);

        const uuids = longAndShortUuid(uuidStr);
        if (!uuids) {
            res.status(400).json({error: "invalid uuid"});
            return;
        }
        const userValidation = await Caching.getUserByUuid(uuids.short);
        if (!userValidation || !userValidation.valid) {
            res.status(400).json({error: "invalid user"});
            return;
        }

        logger.info(debug(`${ options.breadcrumb } Agent:       ${ req.headers["user-agent"] }`), {
            breadcrumb: options.breadcrumb,
            userAgent: req.headers["user-agent"]
        });
        if (req.headers['origin']) {
            logger.info(debug(`${ options.breadcrumb } Origin:      ${ req.headers['origin'] }`), {
                breadcrumb: options.breadcrumb,
                origin: req.headers['origin']
            });
        }
        console.log(debug(`${ options.breadcrumb } Key:         ${ req.apiKey?.name ?? "none" } ${ req.apiKey?._id ?? "" }`));
        console.log(debug(`${ options.breadcrumb } USER:        ${ uuids.long }`))

        const skin = await Generator.generateFromUserAndSave(uuids.long, options, client);
        await sendSkin(req, res, skin, client);
    })

    ///

    async function sendSkin(req: Request, res: Response, skin: SavedSkin, client: ClientInfo): Promise<void> {
        const delayInfo = await Generator.getDelay(await getAndValidateRequestApiKey(req));
        const json = await skin.toResponseJson(skin.duplicate ? {seconds: 0, millis: 100} : delayInfo); //TODO: adjust delay for duplicate
        if (client.userAgent.generic && (client.via === 'api' || client.via === 'other')) {
            (json as any).warnings = [];
            (json as any).warnings.push("generic_user_agent");
        }
        res.json(json);

        if (skin.duplicate) {
            // reset traffic for duplicates
            await updateTraffic(client, new Date(Date.now() - delayInfo.millis))
        }

        getUserFromRequest(req, res, false).then(user => {
            if (!user) return;
            user.skins.push(json.uuid);
            //TODO: limit this
            user.save();
        })
    }

    function getClientInfo(req: GenerateRequest): ClientInfo {
        const rawUserAgent = req.header("user-agent") || "n/a";
        const origin = req.header("origin");
        const ip = getIp(req);
        const via = getVia(req);
        let apiKeyId: Maybe<string>;
        let apiKey;
        if (isApiKeyRequest(req) && req.apiKey) {
            apiKeyId = req.apiKey._id as string;
            apiKey = `${ req.apiKey.key.substring(0, 8) } ${ req.apiKey?.name }`;
        }

        Sentry.setTags({
            "generate_via": via,
            "generate_api_key": apiKey ?? "none"
        });

        const userAgent = simplifyUserAgent(rawUserAgent);

        return {
            userAgent,
            origin,
            ip,
            via,
            apiKey,
            apiKeyId
        };
    }

    function addBreadcrumb(req: GenerateRequest, res: Response) {
        const breadcrumbId = md5(`${ getIp(req) }${ Date.now() }${ Math.random() }`).substr(0, 8);
        const breadcrumb = nextBreadColor()(breadcrumbId);
        req.breadcrumbId = breadcrumbId;
        req.breadcrumb = breadcrumb;
        res.header("X-MineSkin-Breadcrumb", breadcrumbId);
        res.header("X-MineSkin-Timestamp", `${ Date.now() }`);
        Sentry.setExtra("generate_breadcrumb", breadcrumbId);
    }

    function getAndValidateOptions(type: GenerateType, req: GenerateRequest, res: Response): GenerateOptions {
        return Sentry.startSpan({
            op: "generate_getAndValidateOptions",
            name: "getAndValidateOptions"
        }, (span) => {
            let model = validateModel(req.body["model"] || req.query["model"]);
            let variant = validateVariant(req.body["variant"] || req.query["variant"]);
            // Convert & make sure both are set
            if (variant === SkinVariant.UNKNOWN && model !== SkinModel.UNKNOWN) {
                variant = modelToVariant(model);
            } else if (model === SkinModel.UNKNOWN && variant !== SkinVariant.UNKNOWN) {
                model = variantToModel(variant);
            }

            const visibility = validateVisibility(req.body["visibility"] || req.query["visibility"]);
            const name = validateName(req.body["name"] || req.query["name"]);

            const checkOnly = !!(req.body["checkOnly"] || req.query["checkOnly"])

            const breadcrumb = req.breadcrumb;

            console.log(debug(`${ breadcrumb } Type:        ${ type }`))
            console.log(debug(`${ breadcrumb } Variant:     ${ variant }`));
            console.log(debug(`${ breadcrumb } Model:       ${ model }`));
            console.log(debug(`${ breadcrumb } Visibility:  ${ visibility }`));
            console.log(debug(`${ breadcrumb } Name:        "${ name ?? '' }"`));
            if (checkOnly) {
                console.log(debug(`${ breadcrumb } Check Only:  true`));
            }

            Sentry.setTags({
                "generate_type": type,
                "generate_variant": variant,
                "generate_visibility": visibility
            });

            return {
                model,
                variant,
                visibility,
                name,
                breadcrumb,
                checkOnly
            };
        })

    }

    function validateModel(model?: string): SkinModel {
        if (!model || model.length < 3) {
            return SkinModel.UNKNOWN;
        }
        model = model.toLowerCase();

        if (model === "classic" || model === "default" || model === "steve") {
            return SkinModel.CLASSIC;
        }
        if (model === "slim" || model === "alex") {
            return SkinModel.SLIM;
        }

        return SkinModel.UNKNOWN;
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

    function validateVisibility(visibility?: number): SkinVisibility {
        return visibility == 1 ? SkinVisibility.PRIVATE : SkinVisibility.PUBLIC;
    }

    function validateName(name?: string): Maybe<string> {
        if (!name) {
            return undefined;
        }
        name = `${ name }`.substr(0, 20);
        if (name.length === 0) return undefined;
        return name;
    }

}


