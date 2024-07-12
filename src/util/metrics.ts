import { IntervalFlusher, Metric, Metrics } from "metrics-node";
import { NextFunction, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { getConfig, MineSkinConfig } from "../typings/Configs";
import { GenerateType } from "../typings/db/ISkinDocument";
import { GenerateOptions } from "../typings/GenerateOptions";
import { IAccountDocument } from "../typings";
import { isApiKeyRequest } from "../typings/ApiKeyRequest";
import { Maybe } from "./index";

let config: Maybe<MineSkinConfig>;

export class MineSkinMetrics {

    private static instance: Maybe<MineSkinMetrics>;

    public readonly config: MineSkinConfig;
    public readonly metrics: Maybe<Metrics>;
    private readonly flusher: Maybe<IntervalFlusher>;

    public readonly apiRequests: Metric;
    public readonly rateLimit: Metric;
    public readonly urlHosts: Metric;
    public readonly authentication: Metric;
    public readonly requests: Metric;

    public readonly newDuplicate: Metric;
    public readonly successFail: Metric;

    public readonly noAccounts: Metric;
    public readonly hashMismatch: Metric;
    public readonly urlMismatch: Metric;
    public readonly accountNotifications: Metric;
    public readonly accountCapes: Metric;

    public readonly tester: Metric;

    static async get(): Promise<MineSkinMetrics> {
        if (MineSkinMetrics.instance) {
            return MineSkinMetrics.instance;
        }

        if (!config) {
            config = await getConfig();
        }

        MineSkinMetrics.instance = new MineSkinMetrics(config);
        return MineSkinMetrics.instance;
    }

    constructor(config: MineSkinConfig) {
        this.config = config;
        this.metrics = new Metrics(config!.metrics);
        this.flusher = new IntervalFlusher(this.metrics, 10000);
        this.metrics.setFlusher(this.flusher);

        this.apiRequests = this.metrics.metric('mineskin', 'api_requests');
        this.rateLimit = this.metrics.metric('mineskin', 'api_rate_limit');
        this.urlHosts = this.metrics.metric('mineskin', 'generate_url_hosts');
        this.requests = this.metrics.metric('mineskin', 'requests');
        this.authentication = this.metrics.metric('mineskin', 'authentication');
        this.newDuplicate = this.metrics.metric('mineskin', 'generate_new_duplicate');
        this.successFail = this.metrics.metric('mineskin', 'generate_success_fail');
        this.noAccounts = this.metrics.metric('mineskin', 'no_accounts');
        this.hashMismatch = this.metrics.metric('mineskin', 'hash_mismatch');
        this.urlMismatch = this.metrics.metric('mineskin', 'url_mismatch');
        this.tester = this.metrics.metric('mineskin', 'tester');
        this.accountNotifications = this.metrics.metric('mineskin', 'account_notifications');
        this.accountCapes = this.metrics.metric('mineskin', 'account_capes');
    }

    apiRequestsMiddleware(req: Request, res: Response, next: NextFunction) {
        res.on("finish", () => {
            try {
                const route = req.route;
                if (route) {
                    const path = route["path"];
                    if (path) {
                        const m = this.apiRequests
                            .tag("server", config!.server)
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

    durationMetric(duration: number, type: GenerateType, options?: GenerateOptions, account?: IAccountDocument) {
        try {
            const tags: {
                [name: string]: string;
            } = {
                server: config!.server,
                type: type
            };
            if (account) {
                tags.account = account.id;
            }

            this.metrics!.influx.writePoints([{
                measurement: 'duration',
                tags: tags,
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

