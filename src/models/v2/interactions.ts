import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { V2ResponseBody } from "../../typings/v2/V2ResponseBody";
import { UUID } from "../../validation/misc";
import { isPopulatedSkin2Document, Skin2 } from "@mineskin/database";
import { MineSkinError, SkinVisibility2 } from "@mineskin/types";
import { IRedisProvider, TYPES as CoreTypes } from "@mineskin/core";
import { container } from "../../inversify.config";
import { SkinService } from "@mineskin/generator";
import { TYPES as GeneratorTypes } from "@mineskin/generator/dist/ditypes";
import { Discord } from "../../util/Discord";
import { ReportReqBody } from "../../validation/report";

export async function v2AddView(req: MineSkinV2Request, res: Response<V2ResponseBody>) {
    const uuid = UUID.parse(req.params.uuid);
    await Skin2.incViews(uuid);
    const redis = container.get<IRedisProvider>(CoreTypes.RedisProvider);
    if (!redis.client) {
        return;
    }
    await redis.client.incr(`mineskin:interactions:views:total`);
}

export async function v2AddLike(req: MineSkinV2Request, res: Response<V2ResponseBody>) {
    const uuid = UUID.parse(req.params.uuid);
    if (!req.client.hasUser()) {
        throw new MineSkinError('unauthorized', "Unauthorized", {httpCode: 401});
    }
    //TODO: turnstile
    const key = `${ req.client.userId }:${ uuid }`;
    const redis = container.get<IRedisProvider>(CoreTypes.RedisProvider);
    if (!redis.client) {
        return;
    }
    const result = await redis.client.pfAdd('mineskin:interactions:likes', key);
    if (!result) {
        throw new MineSkinError('already_liked', "Already liked", {httpCode: 409});
    }
    await redis.client.incr(`mineskin:interactions:likes:total`);
}

export async function v2ReportSkin(req: MineSkinV2Request, res: Response<V2ResponseBody>) {
    const uuid = UUID.parse(req.params.uuid);
    if (!req.client.hasUser()) {
        throw new MineSkinError('unauthorized', "Unauthorized", {httpCode: 401});
    }
    //TODO: turnstile

    const {reason} = ReportReqBody.parse(req.body);

    const skin = await container.get<SkinService>(GeneratorTypes.SkinService).findForUuid(uuid);
    if (!skin || !isPopulatedSkin2Document(skin) || skin.meta.visibility === SkinVisibility2.PRIVATE) {
        throw new MineSkinError('skin_not_found', 'Skin not found', {httpCode: 404});
    }

    const userId = req.client.userId!;

    if (!skin.reports) {
        skin.reports = [];
    }
    if (skin.reports.some(r => r.user === userId)) {
        throw new MineSkinError('already_reported', "Already reported", {httpCode: 409});
    }
    skin.reports.push({
        user: userId,
        time: new Date(),
        reason: reason
    });
    await skin.save();

    //TODO: move this
    Discord.postDiscordMessage(`Skin reported: https://minesk.in/${ uuid } by ${ userId } - reason: ${ reason }, visibility: ${ skin.meta.visibility }`);
}