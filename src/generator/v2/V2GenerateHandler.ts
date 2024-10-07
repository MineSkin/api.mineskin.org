import { Response } from "express";
import { GenerateOptions, Log, SkinService } from "@mineskin/generator";
import { RateLimitInfo, SkinInfo2, UUID } from "@mineskin/types";
import { IPopulatedSkin2Document, ISkinDocument, isPopulatedSkin2Document } from "@mineskin/database";
import { GenerateV2Request } from "../../routes/v2/types";
import { V2GenerateResponseBody } from "../../typings/v2/V2GenerateResponseBody";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";

export const MC_TEXTURE_PREFIX = "https://textures.minecraft.net/texture/";

export class V2GenerateHandler {

    constructor(
        readonly req: GenerateV2Request,
        readonly res: Response<V2GenerateResponseBody | V2SkinResponse>,
        readonly options: GenerateOptions
    ) {
    }

    async getImageBuffer(): Promise<BufferResult> {
        throw new Error("not implemented");
    }

    static async queryAndSendSkin(req: GenerateV2Request, res: Response, uuid: UUID, duplicate: boolean = false) {
        const skin = await SkinService.findForUuid(uuid);
        if (!skin || !isPopulatedSkin2Document(skin) || !skin.data) {
            return res.status(500).json({
                success: false,
                errors: [
                    {
                        code: 'skin_not_found',
                        message: `skin not found`
                    }
                ]
            });
        }

        return res.json({
            success: true,
            skin: V2GenerateHandler.skinToJson(skin, duplicate),
            rateLimit: V2GenerateHandler.makeRateLimitInfo(req)
        });
    }


    isV1SkinDocument(skin: any): skin is ISkinDocument {
        return 'skinUuid' in skin || 'minecraftTextureHash' in skin;
    }


    static skinToJson(skin: IPopulatedSkin2Document, duplicate: boolean = false): SkinInfo2 {
        if (!skin.data) {
            throw new Error("Skin data is missing");
        }
        Log.l.debug(JSON.stringify(skin.data, null, 2));
        return {
            uuid: skin.uuid,
            name: skin.meta.name,
            visibility: skin.meta.visibility,
            variant: skin.meta.variant,
            texture: {
                data: {
                    value: skin.data.value,
                    signature: skin.data.signature
                },
                hash: {
                    skin: skin.data.hash?.skin.minecraft,
                    cape: skin.data.hash?.cape?.minecraft
                },
                url: {
                    skin: MC_TEXTURE_PREFIX + skin.data.hash?.skin.minecraft,
                    cape: skin.data.hash?.cape?.minecraft ? (MC_TEXTURE_PREFIX + skin.data.hash?.cape?.minecraft) : undefined
                }
            },
            generator: {
                timestamp: skin.data.createdAt.getTime(),
                account: skin.data.generatedBy.account,
                server: skin.data.generatedBy.server,
                worker: skin.data.generatedBy.worker,
                version: 'unknown', //TODO
                duration: skin.data.queue?.end?.getTime() - skin.data.queue?.start?.getTime() || 0
            },
            views: skin.interaction.views,
            duplicate: duplicate
        };
    }

     static makeRateLimitInfo(req: GenerateV2Request): RateLimitInfo {
        const now = Date.now();
        return {
            next: {
                absolute: req.nextRequest || now,
                relative: Math.max(0, (req.nextRequest || now) - now)
            },
            delay: {
                millis: req.minDelay || 0,
                seconds: req.minDelay ? req.minDelay / 1000 : 0
            }
        };
    }

}

export interface BufferResult {
    buffer?: Buffer;
    existing?: UUID;
}