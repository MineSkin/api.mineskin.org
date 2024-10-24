import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { CreditType } from "@mineskin/types";
import { IFlagProvider, TYPES as CoreTypes } from "@mineskin/core";
import { container } from "../inversify.config";

export const grantsMiddleware = async (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    await verifyGrants(req, res);
    next();
}

export const verifyGrants = async (req: MineSkinV2Request, res: Response) => {
    const hasApiKey = req.client.hasApiKey();
    const hasUser = req.client.hasUser();

    const credits = await req.client.getCredits();
    const creditType = credits && credits.isValid() && credits.balance > 0 ? credits.type : undefined;

    const grants = await getDefaultGrants(hasApiKey, hasUser, creditType);
    req.client.grants = {...grants, ...req.client.grants};
}

async function getDefaultGrants(hasApiKey: boolean, hasUser: boolean, creditType: CreditType | undefined) {
    const flags =  container.get<IFlagProvider>(CoreTypes.FlagProvider);
    if (!hasApiKey) {
        // no api key, can't check credits -> use default
        return JSON.parse(await flags.getValue('generator.default_grants.base'));
    }
    if (!creditType) {
        // has api key, but no credits -> use default api key delay
        return JSON.parse(await flags.getValue('generator.default_grants.apikey'));
    }

    if (creditType === CreditType.PAID) {
        // has paid credits -> use default paid credits
        return JSON.parse(await flags.getValue('generator.default_grants.credits.paid'));
    }

    // fallback to default free credits
    return JSON.parse(await flags.getValue('generator.default_grants.credits.free'));
}