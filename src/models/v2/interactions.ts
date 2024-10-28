import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { V2ResponseBody } from "../../typings/v2/V2ResponseBody";
import { UUID } from "../../validation/misc";
import { Skin2 } from "@mineskin/database";
import { MineSkinError } from "@mineskin/types";
import { IRedisProvider, TYPES as CoreTypes } from "@mineskin/core";
import { container } from "../../inversify.config";

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