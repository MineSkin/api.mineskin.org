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
    updateTraffic,
    validateUrl,
    variantToModel
} from "../util";
import { UploadedFile } from "express-fileupload";
import { Generator, SavedSkin } from "../generator/Generator";
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

export const register = (app: Application) => {

    app.use("/generate", corsWithAuthMiddleware);
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

    app.post("/generate/url", async (req: GenerateRequest, res: Response) => {
        const url = validateUrl(req.body["url"] || req.query["url"]);
        if (!url) {
            res.status(400).json({ error: "invalid url" });
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

        console.log(debug(`${ options.breadcrumb } Agent:       ${ req.headers["user-agent"] }`));
        if (req.headers['origin']) {
            console.log(debug(`${ options.breadcrumb } Origin:      ${ req.headers['origin'] }`));
        }
        console.log(debug(`${ options.breadcrumb } Key:         ${ req.apiKey?.name ?? "none" } ${ req.apiKey?._id ?? "" }`));
        console.log(debug(`${ options.breadcrumb } URL:         ${ url }`));

        if (!options.checkOnly || !client.apiKey) {
            await updateTraffic(client);
        }

        const skin = await Generator.generateFromUrlAndSave(url, options, client);
        await sendSkin(req, res, skin);
    })


    //// UPLOAD

    app.post("/generate/upload", async (req: GenerateRequest, res: Response) => {
        if (!req.files) {
            res.status(400).json({ error: "missing files" });
            return;
        }
        const file = req.files["file"] as UploadedFile;
        if (!file) {
            res.status(400).json({ error: "missing file" });
            return;
        }

        const options = getAndValidateOptions(GenerateType.UPLOAD, req, res);
        const client = getClientInfo(req);

        if (!options.checkOnly || !client.apiKey) {
            const requestAllowed = await checkTraffic(req, res);
            if (!requestAllowed) {
                return;
            }
        }

        console.log(debug(`${ options.breadcrumb } Agent:       ${ req.headers["user-agent"] }`));
        if (req.headers['origin']) {
            console.log(debug(`${ options.breadcrumb } Origin:      ${ req.headers['origin'] }`));
        }
        console.log(debug(`${ options.breadcrumb } Key:         ${ req.apiKey?.name ?? "none" } ${ req.apiKey?._id ?? "" }`));
        console.log(debug(`${ options.breadcrumb } FILE:        "${ file.name }" ${ file.md5 }`))

        if (!options.checkOnly || !client.apiKey) {
            await updateTraffic(client);
        }

        const skin = await Generator.generateFromUploadAndSave(file, options, client);
        await sendSkin(req, res, skin);
    })


    //// USER

    app.post("/generate/user", async (req: GenerateRequest, res: Response) => {
        const uuidStr = req.body["uuid"] || req.query["uuid"];
        if (!uuidStr) {
            res.status(400).json({ error: "missing uuid" });
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
            res.status(400).json({ error: "invalid uuid" });
            return;
        }
        const userValidation = await Caching.getUserByUuid(uuids.short);
        if (!userValidation || !userValidation.valid) {
            res.status(400).json({ error: "invalid user" });
            return;
        }

        console.log(debug(`${ options.breadcrumb } Agent:       ${ req.headers["user-agent"] }`));
        if (req.headers['origin']) {
            console.log(debug(`${ options.breadcrumb } Origin:      ${ req.headers['origin'] }`));
        }
        console.log(debug(`${ options.breadcrumb } Key:         ${ req.apiKey?.name ?? "none" } ${ req.apiKey?._id ?? "" }`));
        console.log(debug(`${ options.breadcrumb } USER:        ${ uuids.long }`))

        const skin = await Generator.generateFromUserAndSave(uuids.long, options, client);
        await sendSkin(req, res, skin);
    })

    // TODO: remove at some point
    app.get("/generate/user/:uuid", async (req: GenerateRequest, res: Response) => {
        const uuidStr = req.params["uuid"];
        if (!uuidStr) {
            res.status(400).json({ error: "missing uuid" });
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
            res.status(400).json({ error: "invalid uuid" });
            return;
        }
        const userValidation = await Caching.getUserByUuid(uuids.short);
        if (!userValidation || !userValidation.valid) {
            res.status(400).json({ error: "invalid user" });
            return;
        }

        console.log(debug(`${ options.breadcrumb } Agent:       ${ req.headers["user-agent"] }`));
        if (req.headers['origin']) {
            console.log(debug(`${ options.breadcrumb } Origin:      ${ req.headers['origin'] }`));
        }
        console.log(debug(`${ options.breadcrumb } Key:         ${ req.apiKey?.name ?? "none" } ${ req.apiKey?._id ?? "" }`));
        console.log(debug(`${ options.breadcrumb } USER:        ${ uuids.long }`))

        const skin = await Generator.generateFromUserAndSave(uuids.long, options, client);
        await sendSkin(req, res, skin);
    })

    ///

    async function sendSkin(req: Request, res: Response, skin: SavedSkin): Promise<void> {
        const delayInfo = await Generator.getDelay(await getAndValidateRequestApiKey(req));
        const json = await skin.toResponseJson(skin.duplicate ? { seconds: 0, millis: 100 } : delayInfo); //TODO: adjust delay for duplicate
        res.json(json);

        if (skin.duplicate) {
            await updateTraffic(req, new Date(Date.now() - delayInfo.millis))
        }

        getUserFromRequest(req, res, false).then(user => {
            if (!user) return;
            user.skins.push(json.uuid);
            //TODO: limit this
            user.save();
        })
    }

    function getClientInfo(req: GenerateRequest): ClientInfo {
        const userAgent = req.header("user-agent") || "n/a";
        const origin = req.header("origin");
        const ip = getIp(req);
        const via = getVia(req);
        let apiKeyId;
        let apiKey;
        if (isApiKeyRequest(req) && req.apiKey) {
            apiKeyId = req.apiKey._id;
            apiKey = `${ req.apiKey.key.substr(0, 8) } ${ req.apiKey?.name }`;
        }

        Sentry.setTags({
            "generate_via": via,
            "generate_api_key": apiKey ?? "none"
        });

        return {
            userAgent,
            origin,
            ip,
            via,
            apiKey,
            apiKeyId
        };
    }

    function getAndValidateOptions(type: GenerateType, req: GenerateRequest, res: Response): GenerateOptions {
        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();
        const span = transaction?.startChild({
            op: "generate_getAndValidateOptions"
        })

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

        const breadcrumbId = md5(`${ getIp(req) }${ Date.now() }${ variant }${ visibility }${ Math.random() }${ name }`).substr(0, 8);
        const breadcrumb = nextBreadColor()(breadcrumbId);
        req.breadcrumb = breadcrumb;
        res.header("X-MineSkin-Breadcrumb", breadcrumbId);

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
        Sentry.setExtra("generate_breadcrumb", breadcrumbId);

        span?.finish();
        return {
            model,
            variant,
            visibility,
            name,
            breadcrumb,
            checkOnly
        };
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


