import { v2Router } from "./router";
import { BillingService, TrafficService } from "@mineskin/generator";
import { MineSkinV2Request } from "./types";
import { Response } from "express";
import { v2ErrorHandler } from "../../middleware/error";
import { rateLimitMiddleware } from "../../middleware/rateLimit";
import { mineskinOnlyCorsWithCredentials } from "../../middleware/cors";

export const v2TestRouter = v2Router();
v2TestRouter.use(mineskinOnlyCorsWithCredentials);

v2TestRouter.get("/client", async (req: MineSkinV2Request, res: Response) => {
    const client = req.clientInfo;
    res.json({client});
});

v2TestRouter.get("/apikey", async (req: MineSkinV2Request, res: Response) => {
    const key = req.apiKey;
    res.json({key});
});

v2TestRouter.get("/billing/credits", async (req: MineSkinV2Request, res: Response) => {
    const billingService = BillingService.getInstance();
    const credit = await billingService.getClientCredits(req.clientInfo!)
    res.json({credit});
});

v2TestRouter.post("/billing/simulate-new-skin", async (req: MineSkinV2Request, res: Response) => {
    const billingService = BillingService.getInstance();
    await billingService.trackNewSkin(req.clientInfo!);
    res.json({success: true});
});

v2TestRouter.post("/generate/rate-limit", rateLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = TrafficService.getInstance();
    const count = await trafficService.incRequest(req.clientInfo!);
    res.json({count});
});

v2TestRouter.post("/generate/concurrency", rateLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = TrafficService.getInstance();
    const count = await trafficService.getConcurrent(req.clientInfo!);
    res.json({count});
});

v2TestRouter.post("/generate/concurrency/inc", rateLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = TrafficService.getInstance();
    const count = await trafficService.incrementConcurrent(req.clientInfo!);
    res.json({count});
});

v2TestRouter.post("/generate/concurrency/dec", rateLimitMiddleware, async (req: MineSkinV2Request, res: Response) => {
    const trafficService = TrafficService.getInstance();
    const count = await trafficService.decrementConcurrent(req.clientInfo!);
    res.json({count});
});

v2TestRouter.use("/", v2ErrorHandler);