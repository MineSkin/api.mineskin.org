import { MineSkinV2Request } from "../../routes/v2/types";
import { SkinService } from "@mineskin/generator";
import { Response } from "express";
import { ListReqQuery } from "../../runtype/ListReq";
import { ISkin2Document, Skin2 } from "@mineskin/database";
import { RootFilterQuery } from "mongoose";
import { SkinVisibility2 } from "@mineskin/types";
import { ListedSkin, V2SkinListResponseBody } from "../../typings/v2/V2SkinListResponseBody";

export async function v2SkinList(req: MineSkinV2Request, res: Response<V2SkinListResponseBody>) {
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
        .limit(size)
        .select('uuid meta') //TODO
        .sort({_id: -1})
        .exec();

    //TODO: pagination info
    return res.json({
        success: true,
        skins: skins.map(skinToSimpleJson)
    })
}

function skinToSimpleJson(skin: ISkin2Document): ListedSkin {
    if (!skin.data) {
        throw new Error("Skin data is missing");
    }
    return {
        uuid: skin.uuid,
        name: skin.meta.name,
        visibility: skin.meta.visibility,
        variant: skin.meta.variant,
        views: skin.interaction.views
    };
}