import { Application, Request, Response } from "express";
import { checkTraffic, corsMiddleware, getIp, getVia, longAndShortUuid, md5, modelToVariant, updateTraffic, validateUrl, variantToModel } from "../util";
import { UploadedFile } from "express-fileupload";
import { Generator } from "../generator/Generator";
import { generateLimiter } from "../util/rateLimiters";
import { ClientInfo } from "../typings/ClientInfo";
import { GenerateOptions } from "../typings/GenerateOptions";
import { GenerateType, SkinModel, SkinVariant, SkinVisibility } from "../typings/ISkinDocument";
import { debug } from "../util/colors";
import * as Sentry from "@sentry/node";
import { Bread, nextBreadColor } from "../typings/Bread";
import { GenerateRequest, MineSkinRequest } from "../typings";
import { Caching } from "../generator/Caching";

export const register = (app: Application) => {

    app.use("/generate", corsMiddleware);
    app.use("/generate", generateLimiter);
    app.use("/generate", async (req, res, next) => {
        const delay = await Generator.getDelay();
        res.header("X-MineSkin-Delay", `${ delay || 5 }`);
        next();
    })

    //// URL

    app.post("/generate/url", async (req: GenerateRequest, res: Response) => {
        const url = validateUrl(req.body["url"] || req.query["url"]);
        if (!url) {
            res.status(400).json({ error: "invalid url" });
            return;
        }
        const requestAllowed = await checkTraffic(req, res);
        if (!requestAllowed) {
            return;
        }

        const options = getAndValidateOptions(GenerateType.URL, req);
        console.log(debug(`${ options.breadcrumb } URL:         ${ url }`))
        const client = getClientInfo(req);

        await updateTraffic(req);

        const skin = await Generator.generateFromUrlAndSave(url, options, client);
        res.json(skin.toResponseJson(await Generator.getDelay()));
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
        const requestAllowed = await checkTraffic(req, res);
        if (!requestAllowed) {
            return;
        }

        const options = getAndValidateOptions(GenerateType.UPLOAD, req);
        console.log(debug(`${ options.breadcrumb } FILE:        "${ file.name }" ${ file.md5 }`))
        const client = getClientInfo(req);

        await updateTraffic(req);

        const skin = await Generator.generateFromUploadAndSave(file, options, client);
        res.json(skin.toResponseJson(await Generator.getDelay()));
    })


    //// USER

    app.post("/generate/user", async (req: GenerateRequest, res: Response) => {
        const uuidStr = req.body["uuid"] || req.query["uuid"];
        if (!uuidStr) {
            res.status(400).json({ error: "missing uuid" });
            return;
        }
        const requestAllowed = await checkTraffic(req, res);
        if (!requestAllowed) {
            return;
        }
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

        const options = getAndValidateOptions(GenerateType.USER, req);
        console.log(debug(`${ options.breadcrumb } USER:        ${ uuids.long }`))
        const client = getClientInfo(req);

        await updateTraffic(req);

        const skin = await Generator.generateFromUserAndSave(uuids.long, options, client);
        res.json(skin.toResponseJson(await Generator.getDelay()));
    })

    // TODO: remove at some point
    app.get("/generate/user/:uuid", async (req: GenerateRequest, res: Response) => {
        const uuidStr = req.params["uuid"];
        if (!uuidStr) {
            res.status(400).json({ error: "missing uuid" });
            return;
        }
        const requestAllowed = await checkTraffic(req, res);
        if (!requestAllowed) {
            return;
        }
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

        const options = getAndValidateOptions(GenerateType.USER, req);
        console.log(debug(`${ options.breadcrumb } USER:        ${ uuids.long }`))
        const client = getClientInfo(req);

        await updateTraffic(req);

        const skin = await Generator.generateFromUserAndSave(uuids.long, options, client);
        res.json(skin.toResponseJson(await Generator.getDelay()));
    })

    ///

    function getClientInfo(req: GenerateRequest): ClientInfo {
        const userAgent = req.header("user-agent") || "n/a";
        const origin = req.header("origin");
        const via = getVia(req);

        Sentry.setTag("generate_via", via);

        return {
            userAgent,
            origin,
            via
        };
    }

    function getAndValidateOptions(type: GenerateType, req: GenerateRequest): GenerateOptions {
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

        const breadcrumbId = md5(`${ getIp(req) }${ Date.now() }${ variant }${ visibility }${ Math.random() }${ name }`).substr(0, 8);
        const breadcrumb = nextBreadColor()(breadcrumbId);
        req.breadcrumb = breadcrumb;

        console.log(debug(`${ breadcrumb } Type:        ${ type }`))
        console.log(debug(`${ breadcrumb } Variant:     ${ variant }`));
        console.log(debug(`${ breadcrumb } Visibility:  ${ visibility }`));
        console.log(debug(`${ breadcrumb } Name:        "${ name }"`));

        Sentry.setTags({
            "generate_type": type,
            "generate_variant": variant,
            "generate_visibility": visibility
        });
        Sentry.setExtra("generate_breadcrumb", breadcrumbId);

        return {
            model,
            variant,
            visibility,
            name,
            breadcrumb
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
        return visibility === 1 ? SkinVisibility.PRIVATE : SkinVisibility.PUBLIC;
    }

    function validateName(name?: string): string {
        if (!name) {
            return "";
        }
        return `${ name }`.substr(0, 20);
    }

}


