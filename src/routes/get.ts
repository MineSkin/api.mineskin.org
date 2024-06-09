import { Application, Request, Response } from "express";
import { Generator } from "../generator/Generator";
import { Caching } from "../generator/Caching";
import { Skin, Stat } from "../database/schemas";
import { corsWithAuthMiddleware, getAndValidateRequestApiKey, getIp, getVariant, stripUuid } from "../util";
import * as Sentry from "@sentry/node";
import { ISkinDocument } from "../typings";
import { GenerateType } from "../typings/db/ISkinDocument";
import { GENERATED_UPLOAD_VIEWS, GENERATED_URL_VIEWS, GENERATED_USER_VIEWS, SKINS_VIEWS } from "../generator/Stats";

export const register = (app: Application) => {

    app.use("/get", corsWithAuthMiddleware);

    app.get("/get/delay", async (req: Request, res: Response) => {
        const apiKey = await getAndValidateRequestApiKey(req);
        const delayInfo = await Generator.getDelay(apiKey);
        const lastRequest = apiKey ? await Caching.getTrafficRequestTimeByApiKey(apiKey) : await Caching.getTrafficRequestTimeByIp(getIp(req));
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
                },

                lastRequest: {
                    time: lastRequest.getTime()
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
        const json = await skin.toResponseJson();
        // @ts-ignore
        json['_deprecated'] = "use /get/uuid/:uuid instead. see https://api.mineskin.org/openapi for details"
        res
            .header("Cache-Control", "public, max-age=3600")
            .json(json); // this triggers the generation of a random uuid if it doesn't have one, so do that before saving
        await incSkinViews(skin);
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
        res
            .header("Cache-Control", "public, max-age=3600")
            .json(await skin.toResponseJson());
        await incSkinViews(skin);
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

    app.get("/get/list/:page(\\d+)?", async (req: Request, res: Response) => {
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
            _deprecated: "use list by reference instead. see https://api.mineskin.org/openapi for details",
            skins: skins.map(s => {
                s.uuid = s.skinUuid || s.uuid;
                // delete s.skinUuid;
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

    app.get("/get/list/:after(\\w+)?", async (req: Request, res: Response) => {
        const after = req.params['after'];
        const size = Math.min(Math.max(Number(req.query.hasOwnProperty("size") ? parseInt(req.query["size"] as string) : 16)), 512)

        const query: any = { visibility: 0 };
        if (req.query.hasOwnProperty("filter") && (req.query["filter"]?.length || 0) > 0) {
            query["$text"] = { $search: `${ req.query.filter }`.substr(0, 32) };
        }

        const transaction = Sentry.getCurrentHub().getScope()?.getTransaction();

        let startTime;
        if ('start' === after) {
            startTime = Math.floor(Date.now() / 1000);

            res.header("Cache-Control", "public, max-age=120")
        } else {
            let anchorQuerySpan = transaction?.startChild({
                op: "skin_pagination_after_anchor_query",
                description: "Skin Pagination After Anchor Query"
            });
            const anchor = await Caching.getSkinByUuid(after);
            anchorQuerySpan?.finish();
            if (!anchor) {
                res.status(404).json({
                    msg: 'anchor not found',
                    skins: [],
                    page: {
                        anchor: after
                    },
                    filter: req.query["filter"]
                });
                return;
            }
            startTime = anchor.time;

            res.header("Cache-Control", "public, max-age=3600")
        }

        query['time'] = { $lt: startTime };

        let querySpan = transaction?.startChild({
            op: "skin_pagination_after_query",
            description: "Skin Pagination After Query",
            data: {
                filter: req.query.filter,
                size: size
            }
        });
        const skins = await Skin
            .find(query)
            .limit(size)
            .select({ '_id': 0, id: 1, uuid: 1, skinUuid: 1, name: 1, url: 1, time: 1, variant: 1, model: 1 })
            .sort({ time: -1 })
            .lean()
            .exec();
        querySpan?.finish();

        res.json({
            skins: skins.map(s => {
                s.uuid = s.skinUuid || s.uuid;
                delete s.skinUuid;
                s.variant = getVariant(s);
                return s;
            }),
            page: {
                anchor: after
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

    async function incSkinViews(skin: ISkinDocument) {
        await Skin.incViews(skin.uuid);

        const statPromises = [];
        statPromises.push(Stat.inc(SKINS_VIEWS));
        switch (skin.type) {
            case GenerateType.UPLOAD:
                statPromises.push(Stat.inc(GENERATED_UPLOAD_VIEWS));
                break;
            case GenerateType.URL:
                statPromises.push(Stat.inc(GENERATED_URL_VIEWS));
                break;
            case GenerateType.USER:
                statPromises.push(Stat.inc(GENERATED_USER_VIEWS));
                break;
        }
        await Promise.all(statPromises);
    }

}
