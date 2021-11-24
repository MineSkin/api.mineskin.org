import { Application, Request, Response } from "express";
import { Requests } from "../generator/Requests";
import * as Sentry from "@sentry/node";
import { ISkinDocument } from "../typings";
import { corsMiddleware, Maybe } from "../util";
import { Caching } from "../generator/Caching";

export const register = (app: Application) => {

    app.use("/render", corsMiddleware);

    app.get("/render/:type(head|skin)", (req: Request, res: Response) => {
        const url = req.query["url"] as string;
        if (!url) {
            res.status(400).json({ error: "Missing URL" });
            return;
        }
        const options = req.query["options"] as string || "&aa=true";
        doRender(req, res, url, req.params["type"], options);
    })

    app.get("/render/:id/:type(head|skin)", (req: Request, res: Response) => {
        let id = req.params["id"];
        let promise: Promise<Maybe<ISkinDocument>>;
        if (id.length > 10) {
            promise = Caching.getSkinByUuid(id);
        } else {
            promise = Caching.getSkinById(parseInt(id));
        }
        promise.then((skin: ISkinDocument) => {
            if (!skin) {
                res.status(404).end();
            } else {
                const options = req.query["options"] as string || "&aa=true";
                doRender(req, res, skin.url, req.params["type"], options);
            }
        }).catch((err: any) => {
            Sentry.captureException(err);
        });
    });

    // Helper route to avoid CORS issues
    app.get("/render/texture/:id", (req: Request, res: Response) => {
        let id = req.params["id"];
        let promise: Promise<Maybe<ISkinDocument>>;
        if (id.length > 10) {
            promise = Caching.getSkinByUuid(id);
        } else {
            promise = Caching.getSkinById(parseInt(id));
        }
        promise.then((skin: ISkinDocument) => {
            if (!skin) {
                res.status(404).end();
            } else {
                Requests.genericRequest({
                    url: skin.url,
                    responseType: "stream"
                }).then(response => {
                    res.header("Content-Type", "image/png");
                    response.data.pipe(res);
                }).catch((err: any) => {
                    Sentry.captureException(err);
                    res.status(500).end();
                })
            }
        }).catch((err: any) => {
            Sentry.captureException(err);
        })
    });

    function doRender(req: Request, res: Response, url: string, type: string | undefined, options: string) {
        Requests.axiosInstance.request({
            url: "https://tools.inventivetalent.org/skinrender/3d.php?headOnly=" + (type === "head") + "&user=" + url + options,
            responseType: "stream"
        }).then(response => {
            res.header("Content-Type", "image/png");
            response.data.pipe(res);
        }).catch((err: any) => {
            Sentry.captureException(err);
            res.status(500).end();
        })
    }

}
