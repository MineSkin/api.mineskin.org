import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { IFlagProvider } from "@mineskin/generator";
import { BillingService } from "@mineskin/billing";
import { container } from "tsyringe";

export const creditsMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    await verifyCredits(req, res);
    next();
}

export const verifyCredits = async (req: MineSkinV2Request, res: Response) => {
    if (!req.clientInfo) {
        return;
    }

    const flags =  container.resolve<IFlagProvider>("FlagProvider");
    if (!(await flags.isEnabled('generator.credits.enabled'))) {
        req.clientInfo.usePaidCredits = false;
        return;
    }

    // check credits
    // (always check, even when not enabled, to handle free credits)
    if (req.client.canUseCredits()) {
        const billingService = container.resolve(BillingService);
        const credit = await billingService.creditService.getClientCredits(req.clientInfo);
        if (!credit) {
            req.warnings.push({
                code: 'no_credits',
                message: "no credits"
            });
            req.clientInfo.usePaidCredits = false;
        } else {
            if (!credit.isValid()) {
                req.warnings.push({
                    code: 'invalid_credits',
                    message: "invalid credits"
                });
                req.clientInfo.usePaidCredits = false;
            } else if (credit.balance <= 0) {
                req.warnings.push({
                    code: 'insufficient_credits',
                    message: "insufficient credits"
                });
                req.clientInfo.usePaidCredits = false;
            } else {
                req.client.setCredits(credit);
            }
            res.header('X-MineSkin-Credits-Type', credit.type);
            res.header('X-MineSkin-Credits-Balance', `${ credit.balance }`);
        }
    }
}