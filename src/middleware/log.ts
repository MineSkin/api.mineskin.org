import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import * as Sentry from "@sentry/node";
import { container } from "../inversify.config";
import { IFlagProvider } from "@mineskin/core";
import { TYPES as CoreTypes } from "@mineskin/core/dist/ditypes";

export function requestLogMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
        const request = {
            method: req.method,
            path: req.path,
            query: req.query,
            body: req.body,
            headers: {
                'Host': req.get('Host'),
                'User-Agent': req.get('User-Agent'),
                'Content-Type': req.get('Content-Type'),
                'Content-Length': req.get('Content-Length'),
                'Accept': req.get('Accept'),
                'Accept-Encoding': req.get('Accept-Encoding'),
                'Accept-Language': req.get('Accept-Language'),
                'Connection': req.get('Connection'),
                'Referer': req.get('Referer'),
                'Origin': req.get('Origin'),
                'Authorization': !!req.get('Authorization'),
            }
        };
        const breadcrumb = (req as any).breadcrumbId || (req as any).breadcrumb || 'unknown';
        const oldJson = res.json;
        res.json = (body) => {
            oldJson.call(res, body);
            try {
                const response = {
                    statusCode: res.statusCode,
                    body: body,
                    headers: res.getHeaders()
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

        const sample = Math.random() <= Number(sampleRate);
        if (!sample) return;

        const status = statusStr === '*' ? null : JSON.parse(statusStr);
        if (status && !status.includes(response.statusCode)) return;

        const paths = pathsStr === '*' ? null : JSON.parse(pathsStr);
        if (paths && !paths.includes(request.path)) return;

        const agents = agentsStr === '*' ? null : JSON.parse(agentsStr);
        if (agents && !agents.includes(request.headers['User-Agent'])) return;

        mongoose.connection.db?.collection('request_logs').insertOne({
            request,
            response,
            timestamp: new Date(),
            breadcrumb
        });
    }).catch(e => {
        console.error(e);
        Sentry.captureException(e);
    })
}