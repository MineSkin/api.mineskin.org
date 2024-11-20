import { Application, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { Discord } from "../util/Discord";
import { getConfig } from "../typings/Configs";
import { Skin, Stat } from "@mineskin/database";
import { container } from "../inversify.config";
import { IMetricsProvider } from "@mineskin/core";
import { TYPES as CoreTypes } from "@mineskin/core/dist/ditypes";


export const register = (app: Application) => {

    app.post("/testing/upload_tester_result", async (req: Request, res: Response) => {
        const config = await getConfig();
        if (!config.testerToken || req.body.token !== config.testerToken) return;
        if (!req.body.data) return;
        if (req.headers["user-agent"] !== "mineskin-tester") return;

        try {
            const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
            metrics.getMetric('tester')
                .tag("server", config.server)
                .tag("result", req.body.data.r || "fail")
                .tag("mismatches", req.body.data.m > 0 ? "true" : "false")
                .inc();
        } catch (e) {
            console.warn(e);
            Sentry.captureException(e);
        }

        if (req.body.data.r === "success") {
            Stat.inc("mineskintester.success").then(() => {
                res.sendStatus(202);
            });

            if (req.body.data.m > 0) {
                Discord.postDiscordMessage("🛑 mineskin-tester generated data with " + req.body.data.m + " image mismatches! ID: " + req.body.data.i);
            }

            if (req.body.data.i) {
                Skin.attachTesterResult(req.body.data.i, req.body.data.s, req.body.data.m || 0)
            }
        } else if (req.body.data.r === "fail") {
            Stat.inc("mineskintester.fail").then(() => {
                res.sendStatus(202);
            });
        } else {
            res.sendStatus(400);
        }
    });

}
