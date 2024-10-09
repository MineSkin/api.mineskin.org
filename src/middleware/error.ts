import { GenerateV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { V2GenerateResponseBody } from "../typings/v2/V2GenerateResponseBody";
import { MineSkinError } from "@mineskin/types";
import { V2GenerateHandler } from "../generator/v2/V2GenerateHandler";
import { ValidationError } from "runtypes";
import { Log } from "@mineskin/generator";
import * as Sentry from "@sentry/node";

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
    if (err instanceof ValidationError) {
        return res.status(400).json({
            success: false,
            errors: [
                {
                    code: 'validation_error',
                    message: "Validation error"
                },
                {
                    code: err.code,
                    message: err.message
                }
            ]
        });
    }

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