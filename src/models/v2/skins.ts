import { MineSkinV2Request } from "../../routes/v2/types";
import { Migrations, SkinService } from "@mineskin/generator";
import { Response } from "express";
import { IPopulatedSkin2Document, ISkin2Document, isPopulatedSkin2Document, Skin2 } from "@mineskin/database";
import { RootFilterQuery } from "mongoose";
import { MineSkinError, SkinVisibility2 } from "@mineskin/types";
import { ListedSkin, V2SkinListResponseBody } from "../../typings/v2/V2SkinListResponseBody";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { V2GenerateHandler } from "../../generator/v2/V2GenerateHandler";
import { ListReqQuery } from "../../validation/skins";
import { UUID } from "../../validation/misc";
import { flagsmith } from "@mineskin/generator/dist/flagsmith";
import { Caching } from "../../generator/Caching";

export async function v2SkinList(req: MineSkinV2Request, res: Response<V2SkinListResponseBody>): Promise<V2SkinListResponseBody> {
    const {
        after,
        size,
        filter
    } = ListReqQuery.parse(req.query);

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
        .select('uuid meta data') //TODO
        .populate('data', 'hash.skin.minecraft')
        .sort({_id: -1})
        .exec();

    let lastSkin = skins[skins.length - 1];

    let pagination = {
        current: {
            after: after
        },
        next: {
            after: lastSkin?.uuid
        }
    };

    if (lastSkin) {
        const params = new URLSearchParams();
        if (after) {
            params.set('after', after);
        }
        // params.set('after', lastSkin.uuid);
        params.set('size', `${ size || 16 }`);
        if (filter) {
            params.set('filter', filter);
        }
        req.links.self = `/v2/skins?${ params.toString() }`;

        params.set('after', lastSkin.uuid);
        req.links.next = `/v2/skins?${ params.toString() }`;
    }
    return {
        success: true,
        skins: skins.map(skinToSimpleJson),
        pagination: pagination
    };
}

export async function v2GetSkin(req: MineSkinV2Request, res: Response<V2SkinResponse>): Promise<V2SkinResponse> {
    const uuid = UUID.parse(req.params.uuid);

    req.links.skin = `/v2/skins/${ uuid }`;
    req.links.self = req.links.skin;

    let skin = await SkinService.findForUuid(uuid);

    const flags = await flagsmith.getEnvironmentFlags();
    if (!skin && flags.isFeatureEnabled('migrations.api.get')) {
        const v1Doc = await Caching.getSkinByUuid(uuid);
        if (v1Doc) {
            await Migrations.migrateV1ToV2(v1Doc);
        }
    }

    if (!skin || !isPopulatedSkin2Document(skin)) {
        throw new MineSkinError('skin_not_found', 'Skin not found', {httpCode: 404});
    }

    return {
        success: true,
        skin: V2GenerateHandler.skinToJson(skin)
    };
}

function skinToSimpleJson(skin: ISkin2Document | IPopulatedSkin2Document): ListedSkin {
    return {
        uuid: skin.uuid,
        name: skin.meta.name,
        texture: isPopulatedSkin2Document(skin) ? skin.data?.hash?.skin?.minecraft : undefined
    };
}