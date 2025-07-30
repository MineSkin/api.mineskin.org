import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { V2ResponseBody } from "../../typings/v2/V2ResponseBody";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { UUID } from "../../validation/misc";
import { container } from "../../inversify.config";
import { SkinService } from "@mineskin/generator";
import { TYPES as GeneratorTypes } from "@mineskin/generator/dist/ditypes";
import { validateRequestedSkin } from "./skins";
import { isPopulatedSkin2Document } from "@mineskin/database";
import { Classification } from "@mineskin/database/dist/schemas/Classification";

//TODO
export async function getSkinMeta(req: MineSkinV2Request, res: Response<V2ResponseBody>): Promise<V2MiscResponseBody> {
    const uuid = UUID.parse(req.params.uuid);

    let skin = await container.get<SkinService>(GeneratorTypes.SkinService).findForUuid(uuid);
    skin = validateRequestedSkin(req, skin);

    const meta: any = {};

    if (isPopulatedSkin2Document(skin) && skin.data) {
        const classification = await Classification.findOne({
            texture: skin.data.hash.skin.minecraft,
            status: 'completed',
            flagged: false
        }).exec();
        if (classification) {
            meta['description'] = classification.description;
        }
    }

    return {
        success: true,
        meta: meta
    };
}