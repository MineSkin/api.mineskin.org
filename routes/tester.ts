import { Application, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { Config } from "../types/Config";
import { metrics } from "../util";
import { Skin, Stat } from "../database/schemas";

const config: Config = require("../config");
const TESTER_METRICS = metrics.metric('mineskin', 'tester');

export const register = (app: Application) => {

    app.post("/testing/upload_tester_result", (req: Request, res: Response) => {
        if (!config.testerToken || req.body.token !== config.testerToken) return;
        if (!req.body.data) return;
        if (req.headers["user-agent"] !== "mineskin-tester") return;

        try {
            TESTER_METRICS
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
                Util.postDiscordMessage("🛑 mineskin-tester generated data with " + req.body.data.m + " image mismatches! ID: " + req.body.data.i);
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
