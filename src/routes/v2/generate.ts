import { NextFunction, Request, Response, Router } from "express";
import { apiKeyMiddleware } from "../../middleware/apikey";
import { mineskinClientMiddleware } from "../../middleware/client";
import { breadcrumbMiddleware } from "../../middleware/breadcrumb";
import { v2GenerateFromUpload } from "../../models/v2/generate";
import { MineSkinError } from "@mineskin/types";
import { V2GenerateResponseBody } from "../../typings/v2/V2GenerateResponseBody";
import { ValidationError } from "runtypes";
import * as Sentry from "@sentry/node";
import { logger } from "../../util/log";

export const v2GenerateRouter: Router = Router();

v2GenerateRouter.use("/", breadcrumbMiddleware);
v2GenerateRouter.use("/", apiKeyMiddleware);
v2GenerateRouter.use("/", mineskinClientMiddleware);


v2GenerateRouter.post("/upload", v2GenerateFromUpload);
v2GenerateRouter.post("/url", v2GenerateFromUpload);

v2GenerateRouter.use("/", (err: Error, req: Request, res: Response<V2GenerateResponseBody>, next: NextFunction) => {
    if (err instanceof MineSkinError) {
        return res.status(err.meta?.httpCode || 500).json({
            success: false,
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

    logger.error(err);
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
})