import { Application, Request, Response } from "express";
import { Generator } from "../generator/Generator";
import { Caching } from "../generator/Caching";
import { Skin } from "../database/schemas";
import { corsMiddleware, getIp, stripUuid } from "../util";

export const register = (app: Application) => {

    app.use("/get", corsMiddleware);

    app.get("/get/delay", async (req: Request, res: Response) => {
        const delay = await Generator.getDelay();
        const lastRequest = await Caching.getTrafficRequestTimeByIp(getIp(req));
        if (lastRequest) {
            res.json({
                delay: delay,
                next: Math.round((lastRequest.getTime() / 1000) + delay),
                nextRelative: Math.round(Math.max(0, ((lastRequest.getTime() / 1000) + delay) - (Date.now() / 1000)))
            });
        } else {
            res.json({
                delay: delay,
                next: Math.round(Date.now() / 1000),
                nextRelative: 0
            });
        }
    });

    app.get("/get/stats/:details?", async (req: Request, res: Response) => {
        const stats = await Generator.getStats();
        res.json(stats);
    })

    app.get("/get/id/:id", async (req: Request, res: Response) => {
        const id = parseInt(req.params["id"]);
        if (isNaN(id)) {
            res.status(400).json({ error: "invalid number" });
            return;
        }
        const skin = await Skin.findForId(id);
        if (!skin) {
            res.status(404).json({ error: "Skin not found" });
            return;
        }
        skin.views++;
        if (skin.model === "alex") {
            skin.model = "slim";
        }
        await skin.save();
        res.json(skin.toResponseJson());
    })

    app.get("/get/uuid/:uuid", async (req: Request, res: Response) => {
        const uuid = req.params["uuid"];
        if (uuid.length < 32 || uuid.length > 36) {
            res.status(400).json({ error: "invalid uuid" });
            return;
        }
        const skin = await Skin.findForUuid(stripUuid(uuid));
        if (!skin) {
            res.status(404).json({ error: "Skin not found" });
            return;
        }
        skin.views++;
        if (skin.model === "alex") {
            skin.model = "slim";
        }
        await skin.save();
        res.json(skin.toResponseJson());
    })

    // TODO: add route to get by hash

    app.get("/get/forTexture/:value/:signature?", async (req: Request, res: Response) =>{
        const query: any = {value: req.params["value"]};
        if (req.params.hasOwnProperty("signature")) {
            query.signature = req.params["signature"];
        }
        const skin = await Skin.findOne(query).exec();
        if (!skin) {
            res.status(404).json({ error: "Skin not found" });
            return;
        }
        res.json(skin.toResponseJson());
    })

    app.get("/get/list/:page?", async (req: Request, res: Response) => {
        const page = Math.max((req.params.hasOwnProperty("page") ? parseInt(req.params["page"]) : 1), 1);
        const size = Math.min(Math.max((req.query.hasOwnProperty("size") ? parseInt(req.query["size"] as string) : 16)), 64)

        const query: any = { visibility: 0 };
        if (req.query.hasOwnProperty("filter") && (req.query["filter"]?.length || 0) > 0) {
            query.name = { '$regex': `.*${ req.query["filter"] }.*` }
        }

        const count = await Skin.countDocuments(query).exec();
        const skins = await Skin
            .find(query)
            .skip(size * (page - 1))
            .limit(size)
            .select({ '_id': 0, id: 1, uuid: 1, name: 1, url: 1, time: 1 })
            .sort({ time: -1 })
            .lean()
            .exec();

        res.json({
            skins: skins,
            page: {
                index: page,
                amount: Math.round(count / size),
                total: count
            },
            filter: req.query["filter"]
        });
    })

}
