import { IntervalFlusher, Metrics } from "metrics-node";
import { URL } from "url";
import { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { GenerateOptions } from "../types/GenerateOptions";
import { IAccountDocument } from "../types";
import { GenerateType } from "../types/ISkinDocument";
import exp = require("constants");

const config = require("../config");

export const metrics = new Metrics(config.metrics);
const flusher = new IntervalFlusher(metrics, 10000);
metrics.setFlusher(flusher);


export const API_REQUESTS_METRIC = metrics.metric('mineskin', 'api_requests');
export const apiRequestsMiddleware = (req: Request, res: Response, next: NextFunction) => {
    try {
        const route = req.route;
        if (route) {
            const path = route["path"];
            if (path) {
                API_REQUESTS_METRIC
                    .tag("server", config.server)
                    .tag("method", req.method)
                    .tag("path", path)
                    .inc();
            }
        }
    } catch (e) {
        Sentry.captureException(e);
    }
    next();
}

export const AUTHENTICATION_METRIC = metrics.metric('mineskin', 'authentication');

export const DUPLICATES_METRIC = metrics.metric('mineskin', 'gen_duplicate');
export const NEW_METRIC = metrics.metric('mineskin', 'gen_new');

export const REQUESTS_METRIC = metrics.metric('mineskin', 'requests');

export const durationMetric = (duration: number, type: GenerateType, options?: GenerateOptions, account?: IAccountDocument) => {
    try {
        const tags: {
            [name: string]: string;
        } = {
            server: config.server,
            type: type
        };
        if (account) {
            tags.account = account.id;
        }

        metrics.influx.writePoints([{
            measurement: 'duration',
            tags: tags,
            fields: {
                duration: duration
            }
        }], {
            database: 'mineskin'
        });
    } catch (e) {
        Sentry.captureException(e);
    }
}
