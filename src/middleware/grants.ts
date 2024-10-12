import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { flagsmith } from "@mineskin/generator/dist/flagsmith";
import { CreditType } from "@mineskin/types";

export const grantsMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    const hasApiKey = req.client.hasApiKey();
    const hasUser = req.client.hasUser();

    const credits = await req.client.getCredits();
    const creditType = credits && credits.isValid() && credits.balance > 0 ? credits.type : undefined;

    const grants = await getDefaultGrants(hasApiKey, hasUser, creditType);
    req.client.grants = {...grants, ...req.client.grants};

    next();
}

async function getDefaultGrants(hasApiKey: boolean, hasUser: boolean, creditType: CreditType | undefined) {
    const flags = await flagsmith.getEnvironmentFlags();
    if (!hasApiKey) {
        // no api key, can't check credits -> use default
        return JSON.parse(flags.getFeatureValue('generator.default_grants.base'));
    }
    if (!creditType) {
        // has api key, but no credits -> use default api key delay
        return JSON.parse(flags.getFeatureValue('generator.default_grants.apikey'));
    }

    if (creditType === CreditType.PAID) {
        // has paid credits -> use default paid credits
        return JSON.parse(flags.getFeatureValue('generator.default_grants.credits.paid'));
    }

    // fallback to default free credits
    return JSON.parse(flags.getFeatureValue('generator.default_grants.credits.free'));
}