import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { V2ResponseBody } from "../../typings/v2/V2ResponseBody";
import { UUID } from "../../validation/misc";
import { Skin2 } from "@mineskin/database";

export async function v2AddView(req: MineSkinV2Request, res: Response<V2ResponseBody>) {
    const uuid = UUID.parse(req.params.uuid);
    await Skin2.incViews(uuid);
}

export async function v2AddLike(req: MineSkinV2Request, res: Response<V2ResponseBody>) {
    const uuid = UUID.parse(req.params.uuid);
    //TODO: get user from request; key with user+uuid; redis PFADD
    await Skin2.incLikes(uuid);
}