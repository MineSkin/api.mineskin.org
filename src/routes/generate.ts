import { Application, Request, Response } from "express";
import { checkTraffic,  getVia, longAndShortUuid, updateTraffic, validateUrl } from "../util";
import { UploadedFile } from "express-fileupload";
import { Generator } from "../generator/Generator";
import { generateLimiter } from "../util/rateLimiters";
import { ClientInfo } from "../typings/ClientInfo";
import { GenerateOptions } from "../typings/GenerateOptions";
import { SkinModel, SkinVisibility } from "../typings/ISkinDocument";
import { debug } from "../util/colors";

export const register = (app: Application) => {

    app.use("/generate", generateLimiter);

    //// URL

    app.post("/generate/url", async (req: Request, res: Response) => {
        const url = validateUrl(req.body["url"] || req.query["url"]);
        if (!url) {
            res.status(400).json({ error: "invalid url" });
            return;
        }
        console.log(debug(`URL:         ${ url }`));
        const options = getAndValidateOptions(req);
        const client = getClientInfo(req);

        const requestAllowed = await checkTraffic(req, res);
        if (!requestAllowed) {
            return;
        }
        await updateTraffic(req);

        const skin = await Generator.generateFromUrlAndSave(url, options, client);
        res.json(skin.toResponseJson());
    })


    //// UPLOAD

    app.post("/generate/upload", async (req: Request, res: Response) => {
        if (!req.files) {
            res.status(400).json({ error: "missing files" });
            return;
        }
        const file = req.files["file"] as UploadedFile;
        if (!file) {
            res.status(400).json({ error: "missing file" });
            return;
        }
        console.log(debug(`UPLOAD:      ${ file }`));
        const options = getAndValidateOptions(req);
        const client = getClientInfo(req);

        const requestAllowed = await checkTraffic(req, res);
        if (!requestAllowed) {
            return;
        }
        await updateTraffic(req);

        const skin = await Generator.generateFromUploadAndSave(file, options, client);
        res.json(skin.toResponseJson());
    })


    //// USER

    app.post("/generate/user", async (req: Request, res: Response) => {
        const uuidStr = req.body["uuid"] || req.query["uuid"];
        if (!uuidStr) {
            res.status(400).json({ error: "missing uuid" });
            return;
        }
        const uuids = longAndShortUuid(uuidStr);
        if (!uuids) {
            res.status(400).json({ error: "invalid uuid" });
            return;
        }
        console.log(debug(`USER:        ${ uuidStr }`));
        const options = getAndValidateOptions(req);
        const client = getClientInfo(req);

        const requestAllowed = await checkTraffic(req, res);
        if (!requestAllowed) {
            return;
        }
        await updateTraffic(req);

        const skin = await Generator.generateFromUserAndSave(uuids.long, options, client);
        res.json(skin.toResponseJson());
    })

    // TODO: remove at some point
    app.get("/generate/user/:uuid", async (req: Request, res: Response) => {
        const uuidStr = req.params["uuid"];
        if (!uuidStr) {
            res.status(400).json({ error: "missing uuid" });
            return;
        }
        const uuids = longAndShortUuid(uuidStr);
        if (!uuids) {
            res.status(400).json({ error: "invalid uuid" });
            return;
        }
        console.log(debug(`USER:        ${ uuidStr }`));
        const options = getAndValidateOptions(req);
        const client = getClientInfo(req);

        const requestAllowed = await checkTraffic(req, res);
        if (!requestAllowed) {
            return;
        }
        await updateTraffic(req);

        const skin = await Generator.generateFromUserAndSave(uuids.long, options, client);
        res.json(skin.toResponseJson());
    })

    ///

    function getClientInfo(req: Request): ClientInfo {
        const userAgent = req.header("user-agent") || "n/a";
        const origin = req.header("origin");
        const via = getVia(req);

        return {
            userAgent,
            origin,
            via
        };
    }

    function getAndValidateOptions(req: Request): GenerateOptions {
        const model = validateModel(req.body["model"] || req.query["model"]);
        const visibility = validateVisibility(req.body["visibility"] || req.query["visibility"]);
        const name = validateName(req.body["name"] || req.query["name"]);

        console.log(debug(`Model:       ${ model }`));
        console.log(debug(`Visibility:  ${ visibility }`));
        console.log(debug(`Name:        ${ name }`));

        return {
            model,
            visibility,
            name
        };
    }

    function validateModel(model?: string): SkinModel {
        if (!model) {
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
