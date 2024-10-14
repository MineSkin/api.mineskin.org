import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { BillingService } from "@mineskin/generator";
import { flagsmith } from "@mineskin/generator/dist/flagsmith";

export const creditsMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    await verifyCredits(req, res);
    next();
}

export const verifyCredits = async (req: MineSkinV2Request, res: Response) => {
    if (!req.clientInfo) {
        return;
    }

    const flags = await flagsmith.getEnvironmentFlags();
    if (!flags.isFeatureEnabled('generator.credits.enabled')) {
        req.clientInfo.credits = false;
        return;
    }

    // check credits
    // (always check, even when not enabled, to handle free credits)
    if (req.client.canUseCredits()) {
        const billingService = BillingService.getInstance();
        const credit = await billingService.getClientCredits(req.clientInfo);
        if (!credit) {
            req.warnings.push({
                code: 'no_credits',
                message: "no credits"
            });
            req.clientInfo.credits = false;
        } else {
            if (!credit.isValid()) {
                req.warnings.push({
                    code: 'invalid_credits',
                    message: "invalid credits"
                });
                req.clientInfo.credits = false;
            } else if (credit.balance <= 0) {
                req.warnings.push({
                    code: 'insufficient_credits',
                    message: "insufficient credits"
                });
                req.clientInfo.credits = false;
            } else {
                req.client.setCredits(credit);
            }
            res.header('X-MineSkin-Credits-Type', credit.type);
            res.header('X-MineSkin-Credits-Balance', `${ credit.balance }`);
        }
    }
}