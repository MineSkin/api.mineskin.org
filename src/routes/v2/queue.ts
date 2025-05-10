import { Response, Router } from "express";
import { v2GenerateEnqueue, v2GetJob, v2ListJobs } from "../../models/v2/generate";
import { v2Router } from "./router";
import expressAsyncHandler from "express-async-handler";
import { GenerateV2Request } from "./types";
import { V2JobResponse } from "../../typings/v2/V2JobResponse";
import { formatV2Response } from "../../middleware/response";
import {
    globalConcurrencyInitMiddleware,
    globalConcurrencyLimitMiddleware,
    globalPerMinuteInitMiddleware,
    globalPerMinuteRateLimitMiddleware
} from "../../middleware/rateLimit";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { wildcardCorsWithCredentials } from "../../middleware/cors";

const router: Router = v2Router();
router.use(wildcardCorsWithCredentials);

router.post("/", [
    globalPerMinuteInitMiddleware, globalConcurrencyInitMiddleware,
    globalPerMinuteRateLimitMiddleware, globalConcurrencyLimitMiddleware
], expressAsyncHandler(async (req: GenerateV2Request, res: Response<V2JobResponse>) => {
    const result = await v2GenerateEnqueue(req, res);
    res.json(formatV2Response(req, result));
}));
router.get("/", expressAsyncHandler(async (req: GenerateV2Request, res: Response<V2MiscResponseBody>) => {
    const result = await v2ListJobs(req, res);
    res.header("Cache-Control", "private, no-store, max-age=1");
    res.json(formatV2Response(req, result));
}));
router.get("/:jobId", expressAsyncHandler(async (req: GenerateV2Request, res: Response<V2JobResponse>) => {
    const result = await v2GetJob(req, res);
    res.header("Cache-Control", "max-age=1");
    res.json(formatV2Response(req, result));
}));

export const v2QueueRouter: Router = router;