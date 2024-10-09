import { v2Router } from "./router";
import { BillingService } from "@mineskin/generator";
import { MineSkinV2Request } from "./types";
import { Response } from "express";
import { v2ErrorHandler } from "../../middleware/error";

export const v2TestRouter = v2Router();

v2TestRouter.get("/client",async (req: MineSkinV2Request, res: Response) => {
    const client = req.client;
    res.json({client});
});

v2TestRouter.get("/apikey",async (req: MineSkinV2Request, res: Response) => {
    const key = req.apiKey;
    res.json({key});
});

v2TestRouter.get("/billing/credits",async (req: MineSkinV2Request, res: Response) => {
    const billingService = BillingService.getInstance();
    const credit = await billingService.getClientCredits(req.client!)
    res.json({ credit });
});

v2TestRouter.post("/billing/simulate-new-skin",async (req: MineSkinV2Request, res: Response) => {
    const billingService = BillingService.getInstance();
    await billingService.trackNewSkin(req.client!);
    res.json({ success: true });
});

v2TestRouter.use("/", v2ErrorHandler);