import { NextFunction, Request, Response, Router } from "express";
import { apiKeyMiddleware } from "../../middleware/apikey";
import { mineskinClientMiddleware } from "../../middleware/client";
import { breadcrumbMiddleware } from "../../middleware/breadcrumb";
import { v2GenerateEnqueue, v2GetJob } from "../../models/v2/generate";
import { MineSkinError } from "@mineskin/types";
import { V2GenerateResponseBody } from "../../typings/v2/V2GenerateResponseBody";
import { ValidationError } from "runtypes";
import * as Sentry from "@sentry/node";
import { Log } from "@mineskin/generator";

export const v2QueueRouter: Router = Router();

v2QueueRouter.use("/", breadcrumbMiddleware);
v2QueueRouter.use("/", apiKeyMiddleware);
v2QueueRouter.use("/", mineskinClientMiddleware);


v2QueueRouter.post("/", v2GenerateEnqueue);
v2QueueRouter.get("/:jobId", v2GetJob);

v2QueueRouter.use("/", (err: Error, req: Request, res: Response<V2GenerateResponseBody>, next: NextFunction) => {
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
})