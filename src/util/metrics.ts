import { IntervalFlusher, Metric, Metrics } from "metrics-node";
import { NextFunction, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { isApiKeyRequest } from "../typings/ApiKeyRequest";
import { Maybe } from "./index";
import { GenerateType } from "@mineskin/types";
import { inject, injectable } from "inversify";
import { TYPES as CoreTypes } from "@mineskin/core/dist/ditypes";
import { ILogProvider, IMetricsProvider } from "@mineskin/core";
import { HOSTNAME } from "./host";

@injectable()
export class MineSkinMetrics implements IMetricsProvider {

    private static instance: Maybe<MineSkinMetrics>;

    private readonly metricMap: Map<string, Metric> = new Map<string, Metric>();

    public readonly metrics: Maybe<Metrics>;
    private readonly flusher: Maybe<IntervalFlusher>;


    constructor(@inject(CoreTypes.LogProvider) readonly log: ILogProvider) {
        this.metrics = new Metrics();
        this.flusher = new IntervalFlusher(this.metrics, 1000);
        this.metrics.setFlusher(this.flusher);

        this.register('api_requests', this.metrics.metric('mineskin', 'api_requests'));
        this.register('api_rate_limit', this.metrics.metric('mineskin', 'api_rate_limit'));
        this.register('generate_url_hosts', this.metrics.metric('mineskin', 'generate_url_hosts'));
        this.register('requests', this.metrics.metric('mineskin', 'requests', 'one_month'));
        this.register('authentication', this.metrics.metric('mineskin', 'authentication'));

        this.register('generate_new_duplicate', this.metrics.metric('mineskin', 'generate_new_duplicate'));
        this.register('generate_new', this.metrics.metric('mineskin', 'generate_new'));
        this.register('generate_duplicate', this.metrics.metric('mineskin', 'generate_duplicate'));

        this.register('generate_success_fail', this.metrics.metric('mineskin', 'generate_success_fail'));
        this.register('generate_success', this.metrics.metric('mineskin', 'generate_success'));
        this.register('generate_fail', this.metrics.metric('mineskin', 'generate_fail'));
        this.register('generate_clients', this.metrics.metric('mineskin', 'generate_clients', 'one_year'));
        this.register('generate_accounts', this.metrics.metric('mineskin', 'generate_accounts'));

        this.register('no_accounts', this.metrics.metric('mineskin', 'no_accounts'));
        this.register('hash_mismatch', this.metrics.metric('mineskin', 'hash_mismatch', 'one_month'));
        this.register('url_mismatch', this.metrics.metric('mineskin', 'url_mismatch', 'one_month'));
        this.register('tester', this.metrics.metric('mineskin', 'tester'));
        this.register('account_notifications', this.metrics.metric('mineskin', 'account_notifications', 'one_month'));
        this.register('account_capes', this.metrics.metric('mineskin', 'account_capes', 'one_year'));

        this.register('skin_migrations', this.metrics.metric('mineskin', 'skin_migrations', 'one_year'));

        this.register('skin_tags', this.metrics.metric('mineskin', 'skin_tags', 'one_year'));
        this.register('interactions', this.metrics.metric('mineskin', 'interactions', 'one_year'));

        this.register('credit_usage', this.metrics.metric('mineskin', 'credit_usage', 'one_year'));
    }

    private register(key: string, metric: Metric) {
        this.metricMap.set(key, metric);
    }

    getMetrics(): Metrics {
        return this.metrics!;
    }

    getMetric(key: string): Metric {
        let metric = this.metricMap.get(key);
        if (!metric) {
            throw new Error(`Metric ${ key } not found`);
        }
        return metric!;
    }

    apiRequestsMiddleware(req: Request, res: Response, next: NextFunction) {
        res.on("finish", () => {
            try {
                const route = req.route;
                if (route) {
                    const path = route["path"];
                    if (path) {
                        const m = this.getMetric('api_requests')
                            .tag("server", HOSTNAME)
                            .tag("method", req.method)
                            .tag("path", path)
                            .tag("status", `${ res.statusCode }`);
                        if (isApiKeyRequest(req) && req.apiKey) {
                            m.tag("apikey", `${ req.apiKey.id.substr(0, 8) } ${ req.apiKey?.name }`);
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

    durationMetric(duration: number, type: GenerateType, duplicate: boolean) {
        try {
            this.metrics!.influx.writePoints([{
                measurement: 'duration',
                tags: {
                    server: HOSTNAME,
                    type: type,
                    duplicate: duplicate ? 'true' : 'false',
                    genEnv: process.env.MINESKIN_GEN_ENV || 'api'
                },
                fields: {
                    duration: duration
                }
            }], {
                database: 'mineskin',
                precision: 'ms'
            });
        } catch (e) {
            Sentry.captureException(e);
        }
    }

}

