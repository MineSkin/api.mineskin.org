import { MineSkinV2Request } from "../../routes/v2/types";
import { SkinService } from "@mineskin/generator";
import { Response } from "express";
import { ListReqQuery } from "../../runtype/ListReq";
import { ISkin2Document, isPopulatedSkin2Document, Skin2 } from "@mineskin/database";
import { RootFilterQuery } from "mongoose";
import { MineSkinError, SkinVisibility2 } from "@mineskin/types";
import { ListedSkin, V2SkinListResponseBody } from "../../typings/v2/V2SkinListResponseBody";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { UUID } from "../../runtype/misc";
import { V2GenerateHandler } from "../../generator/v2/V2GenerateHandler";

export async function v2SkinList(req: MineSkinV2Request, res: Response<V2SkinListResponseBody>): Promise<V2SkinListResponseBody> {
    const {
        after,
        size,
        filter
    } = ListReqQuery.check(req.query);

    const query: RootFilterQuery<ISkin2Document> = {
        'meta.visibility': SkinVisibility2.PUBLIC
    };

    if (filter) {
        query['$text'] = {$search: filter};
    }

    if (after) {
        const anchor = await SkinService.findForUuid(after);
        if (anchor) {
            query._id = {$lt: anchor._id};
        }
    }

    const skins = await Skin2.find(query)
        .limit(size || 16)
        .select('uuid meta') //TODO
        .sort({_id: -1})
        .exec();

    //TODO: pagination info
    return {
        success: true,
        skins: skins.map(skinToSimpleJson)
    }
}

export async function v2GetSkin(req: MineSkinV2Request, res: Response<V2SkinResponse>): Promise<V2SkinResponse> {
    const uuid = UUID.check(req.params.uuid);

    const skin = await Skin2.findForUuid(uuid);
    if (!skin || !isPopulatedSkin2Document(skin)) {
        throw new MineSkinError('skin_not_found', 'Skin not found', {httpCode: 404});
    }

    return {
        success: true,
        skin: V2GenerateHandler.skinToJson(skin)
    };
}

function skinToSimpleJson(skin: ISkin2Document): ListedSkin {
    return {
        uuid: skin.uuid,
        name: skin.meta.name
    };
}