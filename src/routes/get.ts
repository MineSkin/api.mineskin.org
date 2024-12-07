import { Application, Request, Response } from "express";
import { Generator } from "../generator/Generator";
import { Caching } from "../generator/Caching";
import { corsWithAuthMiddleware, getAndValidateRequestApiKey, getIp, getVariant, stripUuid } from "../util";
import * as Sentry from "@sentry/node";
import { GENERATED_UPLOAD_VIEWS, GENERATED_URL_VIEWS, GENERATED_USER_VIEWS, SKINS_VIEWS } from "../generator/Stats";
import { ISkinDocument, isPopulatedSkin2Document, Skin, Stat } from "@mineskin/database";
import { GenerateType } from "@mineskin/types";
import { getRedisLastRequest, getRedisNextRequest } from "../database/redis";
import { container } from "../inversify.config";
import { Migrations, SkinService, TYPES as GeneratorTypes } from "@mineskin/generator";
import { V2GenerateHandler } from "../generator/v2/V2GenerateHandler";

export const register = (app: Application) => {

    app.use("/get", corsWithAuthMiddleware);

    app.get("/get/delay", async (req: Request, res: Response) => {
        const apiKey = await getAndValidateRequestApiKey(req);
        const delayInfo = await Generator.getDelay(apiKey);
        const lastRequest = await getRedisLastRequest({
            apiKeyId: apiKey?.id,
            ip: getIp(req),
            time: Date.now()
        });
        const nextRequest = await getRedisNextRequest({
            apiKeyId: apiKey?.id,
            ip: getIp(req),
            time: Date.now()
        });
        if (nextRequest) {
            res.json({
                delay: delayInfo.seconds, // deprecated
                next: Math.round(nextRequest / 1000), // deprecated
                nextRelative: Math.round(Math.max(0, (nextRequest / 1000) - (Date.now() / 1000))), // deprecated

                seconds: delayInfo.seconds,
                millis: delayInfo.millis,
                nextRequest: {
                    time: Math.round(nextRequest),
                    relative: Math.round(Math.max(100, nextRequest - Date.now()))
                },

                lastRequest: {
                    time: lastRequest
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
        const idStr = req.params["id"];
        if (idStr.length === 32 || idStr.length === 36) {
            return res.redirect(301, `/get/uuid/${ idStr }`);
        }
        const id = parseInt(idStr);
        if (isNaN(id)) {
            res.status(400).json({error: "invalid number"});
            return;
        }
        const skin = await Caching.getSkinById(id);
        if (!skin) {
            res.status(404).json({error: "Skin not found"});
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
            res.status(400).json({error: "invalid uuid"});
            return;
        }
        const v1SkinDoc = await Caching.getSkinByUuid(stripUuid(uuid));
        let skin: any;
        if (v1SkinDoc) {
            skin = await v1SkinDoc.toResponseJson();
            await incSkinViews(v1SkinDoc);
        } else {
            // try to find v2 skin
            const skinService = container.get<SkinService>(GeneratorTypes.SkinService);
            const v2SkinDoc = await skinService.findForUuid(stripUuid(uuid));
            if (v2SkinDoc && isPopulatedSkin2Document(v2SkinDoc)) {
                const v2Skin = V2GenerateHandler.skinToJson(v2SkinDoc);
                skin = Migrations.v2SkinInfoToV1Json(v2Skin);
            }
        }
        if (!skin) {
            res.status(404).json({error: "Skin not found"});
            return;
        }
        res
            .header("Cache-Control", "public, max-age=3600")
            .json(skin);
    })

    // TODO: add route to get by hash

    app.get("/get/forTexture/:value/:signature?", async (req: Request, res: Response) => {
        const query: any = {value: req.params["value"]};
        if (req.params.hasOwnProperty("signature")) {
            query.signature = req.params["signature"];
        }
        const skin = await Skin.findOne(query).exec();
        if (!skin) {
            res.status(404).json({error: "Skin not found"});
            return;
        }
        res.json(await skin.toResponseJson());
    })

    app.get("/get/list/:page(\\d+)?", async (req: Request, res: Response) => {
        let page = Number(req.params.hasOwnProperty("page") ? parseInt(req.params["page"]) : 1);
        if (isNaN(page) || page < 1) {
            page = 1;
        }

        let size = Number(req.query.hasOwnProperty("size") ? parseInt(req.query["size"] as string) : 16);
        if (isNaN(size) || size < 1) {
            size = 16;
        }
        if (size > 64) {
            size = 64;
        }

        const query: any = {visibility: 0};
        if (req.query.hasOwnProperty("filter") && ((req.query["filter"] as string | undefined)?.length || 0) > 0) {
            query["$text"] = {$search: `${ req.query.filter }`.substring(0, 32)};
        }

        const count = await Sentry.startSpan({
            op: "skin_pagination_count",
            name: "Skin Pagination Count"
        }, async (countSpan) => {
            return await Caching.getSkinDocumentCount(query);
        });

        const skins = await Sentry.startSpan({
            op: "skin_pagination_query",
            name: "Skin Pagination Query",
            attributes: {
                filter: req.query.filter as string,
                page: page - 1,
                size: size
            }
        }, async (querySpan) => {
            return await Skin
                .find(query)
                .skip(size * (page - 1))
                .limit(size)
                .select({'_id': 0, id: 1, uuid: 1, skinUuid: 1, name: 1, url: 1, time: 1})
                .sort({time: -1})
                .lean()
                .exec();
        });

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
        let size = Number(req.query.hasOwnProperty("size") ? parseInt(req.query["size"] as string) : 16);
        if (isNaN(size) || size < 1) {
            size = 16;
        }
        if (size > 512) {
            size = 512;
        }

        const query: any = {visibility: 0};
        if (req.query.hasOwnProperty("filter") && ((req.query["filter"] as string | undefined)?.length || 0) > 0) {
            query["$text"] = {$search: `${ req.query.filter }`.substring(0, 32)};
        }

        let startTime;
        if ('start' === after) {
            startTime = Math.floor(Date.now() / 1000);

            res.header("Cache-Control", "public, max-age=120")
        } else {
            const anchor = await Sentry.startSpan({
                op: "skin_pagination_after_anchor_query",
                name: "Skin Pagination After Anchor Query"
            }, async (span) => {
                return await Caching.getSkinByUuid(after); //TODO: don't need the entire skin, just the time
            });
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

        query['time'] = {$lt: startTime};

        const skins = await Sentry.startSpan({
            op: "skin_pagination_after_query",
            name: "Skin Pagination After Query",
            attributes: {
                filter: req.query.filter as string,
                size: size
            }
        }, async (querySpan) => {
            return await Skin
                .find(query)
                .limit(size)
                .select({'_id': 0, id: 1, uuid: 1, skinUuid: 1, name: 1, url: 1, time: 1, variant: 1, model: 1})
                .sort({time: -1})
                .lean()
                .exec();
        });

        res.json({
            skins: skins.map(s => {
                s.uuid = s.skinUuid || s.uuid;
                delete s.skinUuid;
                s.variant = getVariant(s as ISkinDocument);
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
            {$match: {visibility: 0}},
            {$sample: {size: 1}}
        ]).exec()).map((s: any) => new Skin(s))[0];

        if (!skin) {
            res.status(404).json({error: "Skin not found"});
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
