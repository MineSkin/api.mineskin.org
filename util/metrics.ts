import { IntervalFlusher, Metrics } from "metrics-node";
import { URL } from "url";
import { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { AxiosRequestConfig, AxiosResponse } from "axios";

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

export const REQUESTS_METRIC = metrics.metric('mineskin', 'requests');
