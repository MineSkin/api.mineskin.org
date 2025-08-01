import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { IFlagProvider, TYPES as CoreTypes } from "@mineskin/core";
import { container } from "../inversify.config";
import * as Sentry from "@sentry/node";

export const creditsMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    await verifyCredits(req, res);
    next();
}

export const verifyCredits = async (req: MineSkinV2Request, res: Response) => {
    return await Sentry.startSpan({
        op: 'middleware',
        name: 'verifyCredits'
    }, async span => {
        if (!req.client) {
            return;
        }

        const flags = container.get<IFlagProvider>(CoreTypes.FlagProvider);
        if (!(await flags.isEnabled('generator.credits.enabled'))) {
            return;
        }

        /*
        // check credits
        // (always check, even when not enabled, to handle free credits)
        if (req.client.canUseCredits() && req.client.userId) {
            const billingService = container.get<BillingService>(BillingTypes.BillingService);
            const holder = await billingService.creditService.getHolder(req.client.userId) as UserCreditHolder;
            const credit = await holder.findFirstApplicableMongoCredit(await req.client.usePaidCredits());
            if (!credit) {
                req.warnings.push({
                    code: 'no_credits',
                    message: "no credits"
                });
                // req.clientInfo.usePaidCredits = false;
            } else {
                if (!credit.isValid()) {
                    req.warnings.push({
                        code: 'invalid_credits',
                        message: "invalid credits"
                    });
                    // req.clientInfo.usePaidCredits = false;
                } else if (credit.balance <= 0) {
                    req.warnings.push({
                        code: 'insufficient_credits',
                        message: "insufficient credits"
                    });
                    // req.clientInfo.usePaidCredits = false;
                } else {
                    req.client.setCredits(credit);
                }
                res.header('MineSkin-Credits-Type', credit.type);
                res.header('MineSkin-Credits-Balance', `${ credit.balance }`);
            }
        }*/
    })
}