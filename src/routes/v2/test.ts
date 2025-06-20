import { v2Router } from "./router";
import { TrafficService, TYPES as GeneratorTypes } from "@mineskin/generator";
import { BillingService, TYPES as BillingTypes } from "@mineskin/billing";
import { MineSkinV2Request } from "./types";
import { Response } from "express";
import {
    globalConcurrencyLimitMiddleware,
    globalPerMinuteInitMiddleware,
    globalPerMinuteRateLimitMiddleware
} from "../../middleware/rateLimit";
import { mineskinOnlyCorsWithCredentials } from "../../middleware/cors";
import { container } from "../../inversify.config";

const router = v2Router();
router.use(mineskinOnlyCorsWithCredentials);

router.get("/client", async (req: MineSkinV2Request, res: Response) => {
    const client = req.clientInfo;
    res.json({client});
});

router.get("/apikey", async (req: MineSkinV2Request, res: Response) => {
    const key = req.apiKey;
    res.json({key});
});

router.post("/billing/simulate-new-skin", async (req: MineSkinV2Request, res: Response) => {
    const billingService = container.get<BillingService>(BillingTypes.BillingService);
    await billingService.trackNewSkin(req.clientInfo!);
    res.json({success: true});
});

router.post("/generate/rate-limit", globalPerMinuteInitMiddleware, globalPerMinuteRateLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = container.get<TrafficService>(GeneratorTypes.TrafficService);
    const count = await trafficService.incRequest(req.clientInfo!);
    res.json({count});
});

router.post("/generate/concurrency", globalConcurrencyLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = container.get<TrafficService>(GeneratorTypes.TrafficService);
    const count = await trafficService.getConcurrent(req.clientInfo!);
    res.json({count});
});

router.post("/generate/concurrency/inc", globalConcurrencyLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = container.get<TrafficService>(GeneratorTypes.TrafficService);
    const count = await trafficService.incrementConcurrent(req.clientInfo!);
    res.json({count});
});

router.post("/generate/concurrency/dec", globalConcurrencyLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = container.get<TrafficService>(GeneratorTypes.TrafficService);
    const count = await trafficService.decrementConcurrent(req.clientInfo!);
    res.json({count});
});

export const v2TestRouter = router;