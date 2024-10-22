import { v2Router } from "./router";
import { TrafficService } from "@mineskin/generator";
import { BillingService } from "@mineskin/billing";
import { MineSkinV2Request } from "./types";
import { Response } from "express";
import { rateLimitMiddleware } from "../../middleware/rateLimit";
import { mineskinOnlyCorsWithCredentials } from "../../middleware/cors";
import { container } from "tsyringe";

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

router.get("/billing/credits", async (req: MineSkinV2Request, res: Response) => {
    const billingService = container.resolve(BillingService);
    const credit = await billingService.creditService.getClientCredits(req.clientInfo!)
    res.json({credit});
});

router.post("/billing/simulate-new-skin", async (req: MineSkinV2Request, res: Response) => {
    const billingService = container.resolve(BillingService);
    await billingService.trackNewSkin(req.clientInfo!);
    res.json({success: true});
});

router.post("/generate/rate-limit", rateLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = container.resolve(TrafficService);
    const count = await trafficService.incRequest(req.clientInfo!);
    res.json({count});
});

router.post("/generate/concurrency", rateLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = container.resolve(TrafficService);
    const count = await trafficService.getConcurrent(req.clientInfo!);
    res.json({count});
});

router.post("/generate/concurrency/inc", rateLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = container.resolve(TrafficService);
    const count = await trafficService.incrementConcurrent(req.clientInfo!);
    res.json({count});
});

router.post("/generate/concurrency/dec", rateLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = container.resolve(TrafficService);
    const count = await trafficService.decrementConcurrent(req.clientInfo!);
    res.json({count});
});

export const v2TestRouter = router;