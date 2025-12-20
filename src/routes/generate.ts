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
    variantToModel
} from "../util";
import { Generator, MAX_IMAGE_SIZE, SavedSkin } from "../generator/Generator";
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
import { GenerateType, SkinVariant, UUID } from "@mineskin/types";
import { SkinModel } from "@mineskin/database";
import { Temp } from "../generator/Temp";
import { MigrationHandler } from "@mineskin/generator";
import { GenerateV2Request, MineSkinV2Request } from "./v2/types";
import { v2GenerateAndWait } from "../models/v2/generate";
import { V2SkinResponse } from "../typings/v2/V2SkinResponse";
import { mineSkinV2InitialMiddleware } from "../middleware/combined";
import { rateLimitMiddlewareWithDelay } from "../middleware/rateLimit";
import { Log } from "../Log";
import { validateModel, validateName, validateVariant, validateVisibility } from "../util/validate";
import { rewriteV2Options } from "../util/compat";

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
        res.header("MineSkin-Api-Version", "v1");
        next();
    });
    app.use("/generate", generateLimiter);
    app.use("/generate", async (req: MineSkinRequest, res, next) => {
        try {
            const key = await getAndValidateRequestApiKey(req);
            const delay = await Generator.getDelay(key);
            req.delayInfo = delay;
            res.header("MineSkin-Delay", `${ delay.seconds || 5 }`); //deprecated
            res.header("MineSkin-Delay-Seconds", `${ delay.seconds || 5 }`);
            res.header("MineSkin-Delay-Millis", `${ delay.millis || 5000 }`);
            next();
        } catch (e) {
            next(e);
        }
    });

    // v2 compatibility layers
    const v2CompatMiddleware = async (req: V2CompatRequest & MineSkinV2Request, res: Response, next: NextFunction) => {
        req.v2Compat = true;

        Log.l.info(`${ req.breadcrumbC } Redirecting to v2 compatibility layer`);
        res.header("MineSkin-Api-Version", "v1-with-v2-compat");
        res.header("MineSkin-Api-Deprecated", "true");
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
    const v2CompatDelayMiddleware = async (req: V2CompatRequest & MineSkinV2Request, res: Response, next: NextFunction) => {
        return await rateLimitMiddlewareWithDelay(req, res, next);
    }

    //// URL

    app.post("/generate/url", [v2CompatMiddleware, v2CompatDelayMiddleware, upload.none()], async (req: GenerateRequest & V2CompatRequest, res: Response) => {
        rewriteV2Options(req);
        const result = await v2GenerateAndWait(req as any as GenerateV2Request, res);
        if ('skin' in result) {
            await sendV2WrappedSkin(req as any as GenerateV2Request, res, (result as V2SkinResponse));
        }
    })


    //// UPLOAD

    app.post("/generate/upload", [v2CompatMiddleware, v2CompatDelayMiddleware], async (req: GenerateRequest & V2CompatRequest, res: Response) => {
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
            (req as any)._uploadProcessed = true;
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

        rewriteV2Options(req);
        const result = await v2GenerateAndWait(req as any as GenerateV2Request, res);
        if ('skin' in result) {
            await sendV2WrappedSkin(req as any as GenerateV2Request, res, (result as V2SkinResponse));
        }
        return;
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
        await Sentry.startSpan({
            op: 'generate_compat',
            name: 'sendV2WrappedSkin'
        }, async span => {
            const json: any = MigrationHandler.v2SkinInfoToV1Json(skin.skin);
            const delayInfo = await Generator.getDelay(req.apiKey);
            json.duplicate = skin.skin.duplicate;
            delete json.visibility;
            json.usage = skin.usage;
            json.rateLimit = skin.rateLimit;
            if (delayInfo) {
                json.nextRequest = Math.round(delayInfo.seconds); // deprecated
                if (req.minDelay) {
                    json.delay = Math.ceil(req.minDelay / 1000);
                    json.delayInfo = {
                        millis: req.minDelay,
                        seconds: Math.ceil(req.minDelay / 1000)
                    };
                } else {
                    json.delay = delayInfo.seconds;
                    json.delayInfo = {
                        millis: delayInfo.millis,
                        seconds: delayInfo.seconds
                    };
                }
            }
            if (req.warnings) {
                json.warnings = req.warnings;
            }
            res.json(json);
        });
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

        Log.l.info(debug(`${ req.breadcrumb } Agent:       ${ req.headers["user-agent"] }`));
        if (req.headers['origin']) {
            Log.l.info(debug(`${ req.breadcrumb } Origin:      ${ req.headers['origin'] }`));
        }
        Log.l.info(debug(`${ req.breadcrumb } IP:           ${ ip }`));
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
        res.header("MineSkin-Breadcrumb", breadcrumbId);
        res.header("MineSkin-Timestamp", `${ Date.now() }`);
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
            const breadcrumbId = req.breadcrumbId;

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
                breadcrumbId,
                checkOnly
            };
        })

    }

}


