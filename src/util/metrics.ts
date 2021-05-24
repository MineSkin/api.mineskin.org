import { IntervalFlusher, Metrics } from "metrics-node";
import { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { getConfig } from "../typings/Configs";
import { GenerateType } from "../typings/db/ISkinDocument";
import { GenerateOptions } from "../typings/GenerateOptions";
import { IAccountDocument } from "../typings";
import { isApiKeyRequest } from "../typings/ApiKeyRequest";

const config = getConfig();

export const metrics = new Metrics(config.metrics);
const flusher = new IntervalFlusher(metrics, 10000);
metrics.setFlusher(flusher);


export const API_REQUESTS_METRIC = metrics.metric('mineskin', 'api_requests');
export const apiRequestsMiddleware = (req: Request, res: Response, next: NextFunction) => {
    res.on("finish", () => {
        try {
            const route = req.route;
            if (route) {
                const path = route["path"];
                if (path) {
                    const m = API_REQUESTS_METRIC
                        .tag("server", config.server)
                        .tag("method", req.method)
                        .tag("path", path)
                        .tag("status", `${ res.statusCode }`);
                    if (isApiKeyRequest(req) && req.apiKey) {
                        m.tag("apikey", `${ req.apiKey.key.substr(0, 8) } ${ req.apiKey?.name }`);
                    }
                    m.inc();
                }
            }
        } catch (e) {
            Sentry.captureException(e);
        }
    })
    next();
}

export const RATE_LIMIT_METRIC = metrics.metric('mineskin', 'api_rate_limit');

export const URL_HOST_METRIC = metrics.metric('mineskin', 'generate_url_hosts');

export const AUTHENTICATION_METRIC = metrics.metric('mineskin', 'authentication');

export const NEW_DUPLICATES_METRIC = metrics.metric('mineskin', 'generate_new_duplicate');
export const SUCCESS_FAIL_METRIC = metrics.metric('mineskin', 'generate_success_fail');

export const NO_ACCOUNTS_METRIC = metrics.metric('mineskin', 'no_accounts');
export const HASH_MISMATCH_METRIC = metrics.metric('mineskin', 'hash_mismatch');

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
