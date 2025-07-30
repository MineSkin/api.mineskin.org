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
import { Time } from "@inventivetalent/time";

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

    if (req.client.hasUser()) {
        const userMeta: any = {
            isOwner: false,
            hasGenerated: false,
            canEdit: false,
        };

        if (skin.clients.some(c => c.user === req.client.userId)) {
            userMeta.hasGenerated = true;
        }
        if (skin.clients.length === 1 && skin.clients[0].user === req.client.userId) {
            userMeta.isOwner = true;
            userMeta.hasGenerated = true;
            userMeta.canEdit = true;

            if (skin.edits && skin.edits.length >= 6) {
                userMeta.canEdit = false; // no more edits allowed
                userMeta.editReason = 'max_edits_reached';
            }
            const skinEditDurationHours = Number(req.client.grants?.skin_edit_duration || 1);
            if (skinEditDurationHours > 0 && skin.createdAt.getTime() + Time.hours(skinEditDurationHours) < Date.now()) {
                userMeta.canEdit = false; // no more edits allowed
                userMeta.editReason = 'edit_duration_expired';
            }
        }

        meta['user'] = userMeta;
    }

    return {
        success: true,
        meta: meta
    };
}