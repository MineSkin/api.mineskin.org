import { v2Router } from "./router";
import { TrafficService, TYPES as GeneratorTypes } from "@mineskin/generator";
import { BillingService, TYPES as BillingTypes, UserCreditHolder } from "@mineskin/billing";
import { MineSkinV2Request } from "./types";
import { Response } from "express";
import { rateLimitMiddleware } from "../../middleware/rateLimit";
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

router.get("/billing/credits", async (req: MineSkinV2Request, res: Response) => {
    const billingService = container.get<BillingService>(BillingTypes.BillingService);
    const holder = await billingService.creditService.getHolder(req.client.userId!) as UserCreditHolder;
    const credit = await holder.findFirstApplicableMongoCredit(await req.client.usePaidCredits());
    res.json({credit});
});

router.post("/billing/simulate-new-skin", async (req: MineSkinV2Request, res: Response) => {
    const billingService = container.get<BillingService>(BillingTypes.BillingService);
    await billingService.trackNewSkin(req.clientInfo!);
    res.json({success: true});
});

router.post("/generate/rate-limit", rateLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = container.get<TrafficService>(GeneratorTypes.TrafficService);
    const count = await trafficService.incRequest(req.clientInfo!);
    res.json({count});
});

router.post("/generate/concurrency", rateLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = container.get<TrafficService>(GeneratorTypes.TrafficService);
    const count = await trafficService.getConcurrent(req.clientInfo!);
    res.json({count});
});

router.post("/generate/concurrency/inc", rateLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = container.get<TrafficService>(GeneratorTypes.TrafficService);
    const count = await trafficService.incrementConcurrent(req.clientInfo!);
    res.json({count});
});

router.post("/generate/concurrency/dec", rateLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = container.get<TrafficService>(GeneratorTypes.TrafficService);
    const count = await trafficService.decrementConcurrent(req.clientInfo!);
    res.json({count});
});

export const v2TestRouter = router;