import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import * as Sentry from "@sentry/node";
import { container } from "../inversify.config";
import { IFlagProvider } from "@mineskin/core";
import { TYPES as CoreTypes } from "@mineskin/core/dist/ditypes";

function getSanitizedAuth(req: any): boolean | string {
    let auth: boolean | string = !!req.get('Authorization');
    if (!auth) {
        return false;
    }
    let header = req.get('Authorization');
    if (header?.startsWith('Bearer ')) {
        header = header.substring('Bearer '.length);
        if (header?.startsWith('msk_')) {
            const split = header.split('_', 3);
            if (split.length === 3) {
                // log API key ID
                auth = `Bearer msk_${ split[1] }_REDACTED`;
            }
        }
    }
    return auth;
}

export function requestLogMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
        const request = {
            method: req.method,
            path: req.path,
            query: req.query,
            body: req.body,
            headers: {
                'host': req.get('Host'),
                'user-agent': req.get('User-Agent'),
                'content-type': req.get('Content-Type'),
                'content-length': req.get('Content-Length'),
                'accept': req.get('Accept'),
                'accept-encoding': req.get('Accept-Encoding'),
                'accept-language': req.get('Accept-Language'),
                'connection': req.get('Connection'),
                'referer': req.get('Referer'),
                'origin': req.get('Origin'),
                'authorization': getSanitizedAuth(req),
            },
            timestamp: new Date(),
        };
        const oldJson = res.json;
        res.json = (body) => {
            oldJson.call(res, body);
            try {
                const breadcrumb = (req as any).breadcrumbId || (req as any).breadcrumb || res.getHeader('mineskin-breadcrumb') || 'unknown';
                const response = {
                    statusCode: res.statusCode,
                    body: body,
                    headers: res.getHeaders(),
                    timestamp: new Date(),
                };
                setTimeout(() => {
                    try {
                        doLog(request, response, breadcrumb);
                    } catch (e) {
                        console.error(e);
                        Sentry.captureException(e);
                    }
                });
            } catch (e) {
                console.error(e);
                Sentry.captureException(e);
            }
            return res;
        }
    } catch (e) {
        console.error(e);
        Sentry.captureException(e);
    }
    next();
}

function doLog(request: any, response: any, breadcrumb: string) {
    Sentry.startSpan({
        op: 'request_log',
        name: 'log request'
    }, async span => {
        const flags = container.get<IFlagProvider>(CoreTypes.FlagProvider);
        const [enabled, pathsStr, agentsStr, statusStr, sampleRate] = await Promise.all([
            flags.isEnabled('api.request_log'),
            flags.getValue('api.request_log.paths'),
            flags.getValue('api.request_log.agents'),
            flags.getValue('api.request_log.status'),
            flags.getValue('api.request_log.sample_rate')
        ]);
        if (!enabled) return;

        const statusCategory = Math.floor(response.statusCode / 100);
        const billable = response.headers?.['x-mineskin-billable'] === 'true';

        const sample =
            (Math.random() <= Number(sampleRate)) ||
            (billable && statusCategory !== 2)
        ;
        if (!sample) return;

        const status = statusStr === '*' ? null : JSON.parse(statusStr);
        if (status && !status.includes(response.statusCode)) return;

        const paths = pathsStr === '*' ? null : JSON.parse(pathsStr);
        if (paths && !paths.includes(request.path)) return;

        const agents = agentsStr === '*' ? null : JSON.parse(agentsStr);
        if (agents && !agents.includes(request.headers['User-Agent'])) return;

        let timestamp = new Date();
        let expiration = undefined;
        switch (statusCategory) {
            case 2:
                expiration = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days
                break;
            case 4:
                expiration = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14); // 14 days
                break;
            case 5:
                expiration = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30); // 30 days
                break;
        }

        if (!mongoose.connection) {
            console.warn("Mongoose connection is not ready, skipping request log.");
            return;
        }

        mongoose.connection.collection('request_logs').insertOne({
            request,
            response,
            timestamp,
            expiration,
            breadcrumb
        }).catch(e => {
            console.error("Failed to log request in mongo:", e);
            Sentry.captureException(e);
        });
    }).catch(e => {
        console.error(e);
        Sentry.captureException(e);
    })
}