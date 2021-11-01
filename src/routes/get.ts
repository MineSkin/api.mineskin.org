import { Application, Request, Response } from "express";
import { Generator } from "../generator/Generator";
import { Caching } from "../generator/Caching";
import { Skin } from "../database/schemas";
import { corsWithAuthMiddleware, getAndValidateRequestApiKey, getIp, stripUuid } from "../util";
import * as Sentry from "@sentry/node";

export const register = (app: Application) => {

    app.use("/get", corsWithAuthMiddleware);

    app.get("/get/delay", async (req: Request, res: Response) => {
        const delayInfo = await Generator.getDelay(await getAndValidateRequestApiKey(req));
        const lastRequest = await Caching.getTrafficRequestTimeByIp(getIp(req));
        if (lastRequest) {
            res.json({
                delay: delayInfo.seconds, // deprecated
                next: Math.round((lastRequest.getTime() / 1000) + delayInfo.seconds), // deprecated
                nextRelative: Math.round(Math.max(0, ((lastRequest.getTime() / 1000) + delayInfo.seconds) - (Date.now() / 1000))), // deprecated

                seconds: delayInfo.seconds,
                millis: delayInfo.millis,
                nextRequest: {
                    time: Math.round(lastRequest.getTime() + delayInfo.millis),
                    relative: Math.round(Math.max(100, ((lastRequest.getTime()) + delayInfo.millis) - Date.now()))
                }
            });
        } else {
            res.json({
                delay: delayInfo.seconds, // deprecated
                next: Math.round(Date.now() / 1000), // deprecated
                nextRelative: 0, // deprecated

                seconds: delayInfo.seconds,
                millis: delayInfo.millis,
                nextRequest: {
                    time: Date.now(),
                    relative: 100
                }
            });
        }
    });

    app.get("/get/stats/:details?", async (req: Request, res: Response) => {
        const stats = await Generator.getStats();
        res
            .header("Cache-Control", "public, max-age=60")
            .json(stats);
    })

    app.get("/get/id/:id", async (req: Request, res: Response) => {
        const id = parseInt(req.params["id"]);
        if (isNaN(id)) {
            res.status(400).json({ error: "invalid number" });
            return;
        }
        const skin = await Caching.getSkinById(id);
        if (!skin) {
            res.status(404).json({ error: "Skin not found" });
            return;
        }
        skin.views++;
        if (skin.model === "alex") {
            skin.model = "slim";
        }
        res
            .header("Cache-Control", "public, max-age=3600")
            .json(await skin.toResponseJson()); // this triggers the generation of a random uuid if it doesn't have one, so do that before saving
        await skin.save();
    })

    app.get("/get/uuid/:uuid", async (req: Request, res: Response) => {
        const uuid = req.params["uuid"];
        if (uuid.length < 32 || uuid.length > 36) {
            res.status(400).json({ error: "invalid uuid" });
            return;
        }
        const skin = await Caching.getSkinByUuid(stripUuid(uuid));
        if (!skin) {
            res.status(404).json({ error: "Skin not found" });
            return;
        }
        skin.views++;
        if (skin.model === "alex") {
            skin.model = "slim";
        }
        res
            .header("Cache-Control", "public, max-age=3600")
            .json(await skin.toResponseJson());
        await skin.save();
    })

    // TODO: add route to get by hash

    app.get("/get/forTexture/:value/:signature?", async (req: Request, res: Response) => {
        const query: any = { value: req.params["value"] };
        if (req.params.hasOwnProperty("signature")) {
            query.signature = req.params["signature"];
        }
        const skin = await Skin.findOne(query).exec();
        if (!skin) {
            res.status(404).json({ error: "Skin not found" });
            return;
        }
        res.json(await skin.toResponseJson());
    })

    app.get("/get/list/:page?", async (req: Request, res: Response) => {
        const page = Math.max(Number(req.params.hasOwnProperty("page") ? parseInt(req.params["page"]) : 1), 1);
        const size = Math.min(Math.max(Number(req.query.hasOwnProperty("size") ? parseInt(req.query["size"] as string) : 16)), 64)

        const query: any = { visibility: 0 };
        if (req.query.hasOwnProperty("filter") && (req.query["filter"]?.length || 0) > 0) {
            query["$text"] = { $search: `${ req.query.filter }`.substr(0, 32) };
        }

        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();

        let countSpan = transaction?.startChild({
            op: "skin_pagination_count",
            description: "Skin Pagination Count"
        });
        const count = await Caching.getSkinDocumentCount(query);
        countSpan?.finish();

        let querySpan = transaction?.startChild({
            op: "skin_pagination_query",
            description: "Skin Pagination Query",
            data: {
                filter: req.query.filter,
                page: page - 1,
                size: size
            }
        });
        const skins = await Skin
            .find(query)
            .skip(size * (page - 1))
            .limit(size)
            .select({ '_id': 0, id: 1, uuid: 1, skinUuid: 1, name: 1, url: 1, time: 1 })
            .sort({ time: -1 })
            .lean()
            .exec();
        querySpan?.finish();

        res.json({
            skins: skins.map(s => {
                s.uuid = s.skinUuid || s.uuid;
                return s;
            }),
            page: {
                index: page,
                amount: Math.round(count / size),
                total: count
            },
            filter: req.query["filter"]
        });
    })

    app.get("/get/random", async (req: Request, res: Response) => {
        const skin = (await Skin.aggregate([
            { $match: { visibility: 0 } },
            { $sample: { size: 1 } }
        ]).exec()).map((s: any) => new Skin(s))[0];

        if (!skin) {
            res.status(404).json({ error: "Skin not found" });
            return;
        }
        res.json(await skin.toResponseJson());
    })

}
