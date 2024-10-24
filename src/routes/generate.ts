import { Application, NextFunction, Request, Response } from "express";
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
import { Generator, MAX_IMAGE_SIZE, SavedSkin, URL_REGEX } from "../generator/Generator";
import { generateLimiter } from "../util/rateLimiters";
import { ClientInfo } from "../typings/ClientInfo";
import { GenerateOptions } from "../typings/GenerateOptions";
import { debug } from "../util/colors";
import * as Sentry from "@sentry/node";
import { nextBreadColor } from "../typings/Bread";
import { GenerateRequest, MineSkinRequest, V2CompatRequest } from "../typings";
import { Caching } from "../generator/Caching";
import { isApiKeyRequest } from "../typings/ApiKeyRequest";
import { getUserFromRequest } from "./account";
import multer, { MulterError } from "multer";
import { DelayInfo } from "../typings/DelayInfo";
import { GenerateType, SkinVariant, SkinVisibility, UUID } from "@mineskin/types";
import { SkinModel } from "@mineskin/database";
import { Temp } from "../generator/Temp";
import { Migrations } from "@mineskin/generator";
import { GenerateV2Request, MineSkinV2Request } from "./v2/types";
import { v2GenerateAndWait } from "../models/v2/generate";
import { V2SkinResponse } from "../typings/v2/V2SkinResponse";
import { mineSkinV2InitialMiddleware } from "../middleware/combined";
import { rateLimitMiddlewareWithDelay } from "../middleware/rateLimit";
import { IFlagProvider, TYPES as CoreTypes } from "@mineskin/core";
import { container } from "../inversify.config";
import { Log } from "../Log";

export const register = (app: Application) => {

    const upload = multer({
        dest: Temp.tmpdir,
        limits: {
            fileSize: MAX_IMAGE_SIZE,
            files: 1,
            fields: 5
        }
    })

    app.use("/generate", corsWithAuthMiddleware);
    app.use("/generate", (req: GenerateRequest, res: Response, next) => {
        addBreadcrumb(req, res);
        res.header("X-MineSkin-Api-Version", "v1");
        next();
    });
    app.use("/generate", generateLimiter);
    app.use("/generate", async (req: MineSkinRequest, res, next) => {
        try {
            const key = await getAndValidateRequestApiKey(req);
            const delay = await Generator.getDelay(key);
            req.delayInfo = delay;
            res.header("X-MineSkin-Delay", `${ delay.seconds || 5 }`); //deprecated
            res.header("X-MineSkin-Delay-Seconds", `${ delay.seconds || 5 }`);
            res.header("X-MineSkin-Delay-Millis", `${ delay.millis || 5000 }`);
            next();
        } catch (e) {
            next(e);
        }
    });

    // v2 compatibility layers
    app.use("/generate", async (req: V2CompatRequest & MineSkinV2Request, res: Response, next: NextFunction) => {
        req.v2Compat = false;
        const flags = container.get<IFlagProvider>(CoreTypes.FlagProvider);
        try {
            const apiKey = (req as V2CompatRequest).apiKey;
            if (apiKey) {
                if (req.query["v2"]) {
                    req.v2Compat = true;
                } else {
                    if (apiKey.grants && (apiKey.grants as any).v2_compat) {
                        req.v2Compat = true
                    } else if (apiKey && await flags.isEnabled('api.v2_compat.all_requests')) {
                        req.v2Compat = true;
                    }
                }
            }
        } catch (e) {
            Sentry.captureException(e);
            Log.l.error(e);
        }

        if (req.v2Compat) {
            try {
                const [enabled, chance] = await Promise.all([
                    flags.isEnabled('api.v2_compat.chance'),
                    flags.getValue('api.v2_compat.chance')
                ]);
                if (!enabled) {
                    req.v2Compat = false;
                    req.warnings.push({
                        code: "compat_disabled",
                        message: "v2 compatibility is currently disabled"
                    });
                } else if (chance) {
                    const random = Math.random();
                    if (random > Number(chance)) {
                        req.v2Compat = false;
                        req.warnings.push({
                            code: "compat_disabled",
                            message: "v2 compatibility is currently disabled"
                        });
                    }
                }
            } catch (e) {
                Sentry.captureException(e);
                Log.l.error(e);
            }
        }

        if (req.v2Compat) {
            Log.l.info(`${ req.breadcrumbC } Redirecting to v2 compatibility layer`);
            res.header("X-MineSkin-Api-Version", "v1-with-v2-compat");
            res.header("X-MineSkin-Api-Deprecated", "true");
            Sentry.setExtra('v2_compat', true);
            if (!req.warnings) {
                req.warnings = [];
            }
            req.warnings.push({
                code: "deprecated",
                message: "this endpoint is deprecated, please use the v2 API"
            });
            return await mineSkinV2InitialMiddleware(req, res, next);
        }

        next();
    });
    app.use("/generate", async (req: MineSkinV2Request & V2CompatRequest, res: Response, next: NextFunction) => {
        if (req.v2Compat) {
            return await rateLimitMiddlewareWithDelay(req, res, next);
        }
        next();
    });

    //// URL

    app.post("/generate/url", upload.none(), async (req: GenerateRequest & V2CompatRequest, res: Response) => {
        if (req.v2Compat) {
            const result = await v2GenerateAndWait(req as any as GenerateV2Request, res);
            if ('skin' in result) {
                await sendV2WrappedSkin(req as any as GenerateV2Request, res, (result as V2SkinResponse));
            }
            return;
        }

        const url = validateUrl(req.body["url"] || req.query["url"]);
        if (!url || !URL_REGEX.test(url)) {
            res.status(400).json({error: "invalid url"});
            return;
        }

        const options = getAndValidateOptions(GenerateType.URL, req, res);
        const client = getClientInfo(req);

        if (!options.checkOnly || !client.apiKey) {
            const requestAllowed = await checkTraffic(client, req, res);
            if (!requestAllowed) {
                return;
            }
        }

        console.log(debug(`${ options.breadcrumb } URL:         ${ url }`));

        if (!options.checkOnly || !client.apiKey) {
            await updateTraffic(client);
        }

        const skin = await Generator.generateFromUrlAndSave(url, options, client);
        await sendSkin(req, res, skin, client);
    })


    //// UPLOAD

    app.post("/generate/upload", async (req: GenerateRequest & V2CompatRequest, res: Response) => {
        if (req.v2Compat) {
            const result = await v2GenerateAndWait(req as any as GenerateV2Request, res);
            if ('skin' in result) {
                await sendV2WrappedSkin(req as any as GenerateV2Request, res, (result as V2SkinResponse));
            }
            return;
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
                res.status(400).json({error: `invalid file: ${ e.message } (${ e.code })`});
                return;
            } else {
                res.status(500).json({error: "upload error"});
                return;
            }
        }

        const options = getAndValidateOptions(GenerateType.UPLOAD, req, res);
        const client = getClientInfo(req);

        if (!options.checkOnly || !client.apiKey) {
            const requestAllowed = await checkTraffic(client, req, res);
            if (!requestAllowed) {
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

        const requestAllowed = await checkTraffic(client, req, res);
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
        //TODO: cache users in redis
        const userValidation = await Caching.getUserByUuid(uuids.short);
        if (!userValidation || !userValidation.valid) {
            res.status(400).json({error: "invalid user"});
            return;
        }

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

        const requestAllowed = await checkTraffic(client, req, res);
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

        console.log(debug(`${ options.breadcrumb } USER:        ${ uuids.long }`))

        const skin = await Generator.generateFromUserAndSave(uuids.long, options, client);
        await sendSkin(req, res, skin, client, ["this endpoint is deprecated, use POST /generate/user"]);
    })

    ///

    async function sendSkin(req: Request, res: Response, skin: SavedSkin, client: ClientInfo, warnings: string[] = []): Promise<void> {
        const delayInfo = client.delayInfo || await Generator.getDelay(await getAndValidateRequestApiKey(req));
        const json = await skin.toResponseJson(delayInfo);

        (json as any).warnings = warnings;
        if (client.userAgent.generic && (client.via === 'api' || client.via === 'other')) {
            (json as any).warnings.push("please use a proper user-agent header");
        }

        res.json(json);

        // if (skin.duplicate) {
        //     // reset traffic for duplicates
        //     try {
        //         if (client.delayInfo) {
        //             updateRedisNextRequest(client, 500).catch(e => {
        //                 console.error(e);
        //                 Sentry.captureException(e);
        //             });
        //         }
        //     } catch (e) {
        //         console.error(e);
        //         Sentry.captureException(e);
        //     }
        // }

        getUserFromRequest(req, res, false).then(user => {
            if (!user) return;
            user.skins.push(json.uuid);
            //TODO: limit this
            user.save();
        })
    }

    async function sendV2WrappedSkin(req: GenerateV2Request, res: Response, skin: V2SkinResponse) {
        const json: any = Migrations.v2SkinInfoToV1Json(skin.skin);
        const delayInfo = await Generator.getDelay(req.apiKey);
        json.duplicate = skin.skin.duplicate;
        if (delayInfo) {
            json.nextRequest = Math.round(delayInfo.seconds); // deprecated

            json.delayInfo = {
                millis: delayInfo.millis,
                seconds: delayInfo.seconds
            }
        }
        if (req.warnings) {
            json.warnings = req.warnings;
        }
        res.json(json);
    }

    function getClientInfo(req: GenerateRequest): ClientInfo {
        const rawUserAgent = req.header("user-agent") || "n/a";
        const origin = req.header("origin");
        const ip = getIp(req);
        const via = getVia(req);
        let apiKeyId: Maybe<string>;
        let apiKey;
        let billable = false;
        let metered = false;
        let useCredits = false;
        let user: Maybe<UUID>;
        if (isApiKeyRequest(req) && req.apiKey) {
            apiKeyId = req.apiKey.id;
            apiKey = `${ apiKeyId?.substring(0, 8) } ${ req.apiKey?.name }`;
            user = req.apiKey.user;
            billable = req.apiKey.billable || false;
            metered = req.apiKey.metered || false;
            useCredits = req.apiKey.useCredits || false;
        }
        let delayInfo: Maybe<DelayInfo>;
        if ('delayInfo' in req) {
            delayInfo = req.delayInfo;
        }

        Sentry.setTags({
            "generate_via": via,
            "generate_api_key": apiKey ?? "none",
            "generate_billable": billable,
            "generate_metered": metered,
            "generate_use_credits": useCredits
        });

        const userAgent = simplifyUserAgent(rawUserAgent);

        const time = Date.now();

        Log.l.info(debug(`${ req.breadcrumb } Agent:       ${ req.headers["user-agent"] }`), {
            breadcrumb: req.breadcrumb,
            userAgent: req.headers["user-agent"]
        });
        if (req.headers['origin']) {
            Log.l.info(debug(`${ req.breadcrumb } Origin:      ${ req.headers['origin'] }`), {
                breadcrumb: req.breadcrumb,
                origin: req.headers['origin']
            });
        }
        console.log(debug(`${ req.breadcrumb } Key:         ${ req.apiKey?.name ?? "none" } ${ req.apiKey?._id ?? "" }`));

        return {
            time,
            userAgent,
            origin,
            ip,
            via,
            apiKey,
            apiKeyId,
            delayInfo,
            user,
            billable,
            metered,
            useCredits
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
        return visibility == 1 ? SkinVisibility.UNLISTED : SkinVisibility.PUBLIC;
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


