import { MineSkinV2Request } from "../../routes/v2/types";
import { Migrations, SkinService, TYPES as GeneratorTypes } from "@mineskin/generator";
import { Response } from "express";
import {
    IPopulatedSkin2Document,
    ISkin2Document,
    isPopulatedSkin2Document,
    Skin2,
    SkinData,
    User
} from "@mineskin/database";
import { FilterQuery, SortOrder } from "mongoose";
import { Maybe, MineSkinError, SkinVisibility2 } from "@mineskin/types";
import { ListedSkin, V2SkinListResponseBody } from "../../typings/v2/V2SkinListResponseBody";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { V2GenerateHandler } from "../../generator/v2/V2GenerateHandler";
import { ListReqQuery } from "../../validation/skins";
import { UUIDOrShortId } from "../../validation/misc";
import { Caching } from "../../generator/Caching";
import * as Sentry from "@sentry/node";
import { IFlagProvider, TYPES as CoreTypes } from "@mineskin/core";
import { container } from "../../inversify.config";
import { Log } from "../../Log";
import { stripUuid } from "../../util";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";

type QueryCustomizer = (args: {
    query: FilterQuery<ISkin2Document>,
    sort: Record<string, SortOrder>
}) => void;

export async function v2LatestSkinList(req: MineSkinV2Request, res: Response<V2SkinListResponseBody>): Promise<V2SkinListResponseBody> {
    return await v2ListSkins(req, res);
}

export async function v2PopularSkinList(req: MineSkinV2Request, res: Response<V2SkinListResponseBody>): Promise<V2SkinListResponseBody> {
    return await v2ListSkins(req, res, ({query, sort}) => {
        //TODO: custom range (weekly/monthly)
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);
        query['updatedAt'] = {$gte: oneDayAgo}

        // extra check to not include recently migrated skins
        // TODO: remove
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        query['createdAt'] = {$gte: oneWeekAgo}

        query['interaction.views'] = {$gt: 5};

        sort['interaction.views'] = -1;
    });
}

export async function v2UserSkinList(req: MineSkinV2Request, res: Response<V2SkinListResponseBody>): Promise<V2SkinListResponseBody> {
    if (!req.client.hasUser()) {
        throw new MineSkinError('unauthorized', 'Unauthorized', {httpCode: 401});
    }
    return await v2ListSkins(req, res, ({query, sort}) => {
        // filter by user
        query['clients.user'] = req.client.userId;
        // allow all visibilities
        query['meta.visibility'] = {
            $in: [
                SkinVisibility2.PUBLIC,
                SkinVisibility2.UNLISTED,
                SkinVisibility2.PRIVATE
            ]
        };

        // limit results
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        query['createdAt'] = {$gte: threeMonthsAgo};
    });
}

export async function v2ListSkins(req: MineSkinV2Request, res: Response<V2SkinListResponseBody>, customizer?: QueryCustomizer): Promise<V2SkinListResponseBody> {
    const {
        after,
        size,
        filter
    } = ListReqQuery.parse(req.query);

    const query: FilterQuery<ISkin2Document> = {
        'meta.visibility': SkinVisibility2.PUBLIC
    };

    if (filter) {
        query['$text'] = {$search: filter};
    }

    const sort: Record<string, SortOrder> = {_id: -1};

    if (customizer) {
        customizer({query, sort});
    }

    if (after) {
        const anchor = await container.get<SkinService>(GeneratorTypes.SkinService).findForUuid(after);
        if (anchor) {
            query._id = {$lt: anchor._id};
        }
    }

    const skins = await Skin2.find(query)
        .limit(size || 16)
        .select('uuid meta data updatedAt') //TODO
        .populate('data', 'hash.skin.minecraft')
        .sort(sort)
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
    const uuidOrShort = UUIDOrShortId.parse(req.params.uuid);

    req.links.skin = `/v2/skins/${ uuidOrShort }`;
    req.links.self = req.links.skin;

    const skinService = container.get<SkinService>(GeneratorTypes.SkinService);
    let skin;
    if (uuidOrShort.length === 8) {
        skin = await skinService.findForShortId(uuidOrShort);
    } else {
        skin = await skinService.findForUuid(stripUuid(uuidOrShort));
    }

    const flags = container.get<IFlagProvider>(CoreTypes.FlagProvider);
    try {
        if (!skin && uuidOrShort.length !== 8 && await flags.isEnabled('migrations.api.get')) {
            const v1Doc = await Caching.getSkinByUuid(uuidOrShort);
            if (v1Doc) {
                skin = await Migrations.migrateV1ToV2(v1Doc, "skin-get");
                skin.data = await SkinData.findById(skin.data) || skin.data;
            }
        }
    } catch (e) {
        Sentry.captureException(e);
        Log.l.error(e);
    }

    skin = validateRequestedSkin(req, skin);

    req.links.skin = `/v2/skins/${ skin.uuid }`;
    req.links.self = req.links.skin;

    return {
        success: true,
        skin: V2GenerateHandler.skinToJson(skin)
    };
}

export async function v2GetSkinTextureRedirect(req: MineSkinV2Request, res: Response<V2SkinResponse>): Promise<void> {
    const uuidOrShort = UUIDOrShortId.parse(req.params.uuid);

    const skinService = container.get<SkinService>(GeneratorTypes.SkinService);
    let skin;
    if (uuidOrShort.length === 8) {
        skin = await skinService.findForShortId(uuidOrShort);
    } else {
        skin = await skinService.findForUuid(stripUuid(uuidOrShort));
    }

    skin = validateRequestedSkin(req, skin);

    res.redirect(301, `https://mineskin.org/textures/${ skin.data?.hash?.skin?.minecraft }`)
}

export async function v2UserLegacySkinList(req: MineSkinV2Request, res: Response<V2SkinListResponseBody>): Promise<V2MiscResponseBody> {
    if (!req.client.hasUser()) {
        throw new MineSkinError('unauthorized', 'Unauthorized', {httpCode: 401});
    }
    const user = await User.findByUUID(req.client.userId!);
    if (!user) {
        throw new MineSkinError('user_not_found', 'User not found', {httpCode: 404});
    }
    user.skins = user.skins || [];
    return {
        success: true,
        skins: {
            v1: user.skins
        }
    };
}

export function validateRequestedSkin(req: MineSkinV2Request, skin: Maybe<ISkin2Document>): IPopulatedSkin2Document {
    if (!skin || !isPopulatedSkin2Document(skin)) {
        throw new MineSkinError('skin_not_found', 'Skin not found', {httpCode: 404});
    }

    if (skin.meta.visibility === SkinVisibility2.PRIVATE) {
        let usersMatch = false;
        if (req.client.hasUser()) {
            usersMatch = skin.clients.some(c => c.user === req.client.userId);
        }
        if (!usersMatch) {
            throw new MineSkinError('skin_not_found', 'Skin not found', {httpCode: 404});
        }
    }

    return skin!;
}

function skinToSimpleJson(skin: ISkin2Document | IPopulatedSkin2Document): ListedSkin {
    return {
        uuid: skin.uuid,
        name: skin.meta.name,
        texture: isPopulatedSkin2Document(skin) ? skin.data?.hash?.skin?.minecraft : undefined,
        timestamp: skin.updatedAt?.getTime()
    };
}