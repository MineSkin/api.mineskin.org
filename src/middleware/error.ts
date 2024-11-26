import { GenerateV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { V2GenerateResponseBody } from "../typings/v2/V2GenerateResponseBody";
import { MineSkinError } from "@mineskin/types";
import { V2GenerateHandler } from "../generator/v2/V2GenerateHandler";
import * as Sentry from "@sentry/node";
import { ZodError } from "zod";
import { CodeAndMessage } from "../typings/v2/CodeAndMessage";
import { Log } from "../Log";

export function v2ErrorHandler(err: Error, req: GenerateV2Request, res: Response<V2GenerateResponseBody>, next: NextFunction) {
    if (err instanceof MineSkinError) {
        return res.status(err.meta?.httpCode || 500).json({
            success: false,
            rateLimit: V2GenerateHandler.makeRateLimitInfo(req),
            errors: [{
                code: err.code,
                message: err.msg || err.message
            }]
        });
    }
    if (err instanceof ZodError) {
        const errors: CodeAndMessage[] = [
            {
                code: 'validation_error',
                message: "Validation error"
            }
        ];
        for (const issue of err.issues) {
            errors.push({
                code: issue.code,
                message: issue.message + (issue.path ? ` (${ issue.path.join('.') })` : '')
            });
        }
        return res.status(400).json({
            success: false,
            errors: errors
        });
    }

    Log.l.error(err.name);
    Log.l.error(err);
    Sentry.captureException(err, {
        level: "fatal"
    });
    return res.status(500).json({
        success: false,
        errors: [{
            code: "internal_error",
            message: "An internal error occurred"
        }]
    });
}

export function v2NotFoundHandler(req: GenerateV2Request, res: Response<V2GenerateResponseBody>) {
    return res.status(404).json({
        success: false,
        errors: [{
            code: "not_found",
            message: `Not found (${ req.originalUrl })`
        }]
    });
}