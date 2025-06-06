import { Response } from "express";
import { ImageHashes, SkinService, TYPES as GeneratorTypes } from "@mineskin/generator";
import { GenerateOptions, GenerateType, RateLimitInfo, SkinInfo2, UUID } from "@mineskin/types";
import { IPopulatedSkin2Document, ISkinDocument, isPopulatedSkin2Document } from "@mineskin/database";
import { GenerateV2Request } from "../../routes/v2/types";
import { V2GenerateResponseBody } from "../../typings/v2/V2GenerateResponseBody";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { container } from "../../inversify.config";
import * as Sentry from "@sentry/node";

export const MC_TEXTURE_PREFIX = "https://textures.minecraft.net/texture/";

export class V2GenerateHandler {

    constructor(
        readonly req: GenerateV2Request,
        readonly res: Response<V2GenerateResponseBody | V2SkinResponse>,
        readonly options: GenerateOptions,
        readonly type: GenerateType
    ) {
    }

    handlesImage(): boolean {
        return true;
    }

    async getImageBuffer(): Promise<BufferResult> {
        throw new Error("not implemented");
    }

    async getImageReference(hashes?: ImageHashes): Promise<string> {
        return hashes!.minecraft;
    }

    cleanupImage() {
    }

    static async queryAndSendSkin(req: GenerateV2Request, res: Response, uuid: UUID, duplicate: boolean = false) {
        const skin = await container.get<SkinService>(GeneratorTypes.SkinService).findForUuid(uuid);
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
            rateLimit: V2GenerateHandler.makeRateLimitInfo(req, res)
        });
    }


    isV1SkinDocument(skin: any): skin is ISkinDocument {
        return 'skinUuid' in skin || 'minecraftTextureHash' in skin;
    }


    static skinToJson(skin: IPopulatedSkin2Document, duplicate: boolean = false): SkinInfo2 {
        return Sentry.startSpan({
            op: 'generate_handler',
            name: 'skinToJson'
        }, span => {
            if (!skin.data) {
                throw new Error("Skin data is missing");
            }
            return {
                uuid: skin.uuid,
                shortId: skin.shortId,
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
                    account: skin.data.generatedBy.account?.substring(0, 16),
                    server: skin.data.generatedBy.server,
                    worker: skin.data.generatedBy.worker,
                    version: 'unknown', //TODO
                    duration: skin.data.queue?.end?.getTime() - skin.data.queue?.start?.getTime() || 0
                },
                tags: skin.tags?.map(t => ({tag: t.tag})),
                views: skin.interaction.views,
                duplicate: duplicate
            };
        });
    }

    static makeRateLimitInfo(req: GenerateV2Request, res?: Response): RateLimitInfo {
        return Sentry.startSpan({
            op: 'generate_handler',
            name: 'makeRateLimitInfo'
        }, span => {
            const now = Date.now();

            const remaining = Math.max(0, (req.maxPerMinute || 0) - (req.requestsThisMinute || 0));
            if (remaining <= 0) {
                req.nextRequest = Math.max(req.nextRequest || 0, (req.maxPerMinuteReset || 0) * 1000, now)
            }

            const info = {
                next: {
                    absolute: req.nextRequest || now,
                    relative: Math.max(0, (req.nextRequest || now) - now)
                },
                delay: {
                    millis: req.minDelay || 0,
                    seconds: req.minDelay ? req.minDelay / 1000 : 0
                },
                limit: {
                    limit: req.maxPerMinute || 0,
                    remaining: remaining,
                    reset: req.maxPerMinuteReset || Math.floor(now / 1000)
                }
            };
            if (res) {
                res.header('X-RateLimit-Limit', `${ info.limit.limit }`);
                res.header('X-RateLimit-Remaining', `${ info.limit.remaining }`);
                res.header('X-RateLimit-Reset', `${ info.limit.reset }`);

                res.header('X-RateLimit-Delay', `${ info.delay.millis }`);
                res.header('X-RateLimit-NextRequest', `${ info.next.absolute }`);

                if (remaining <= 0 && res.statusCode === 429) {
                    res.header('Retry-After', `${ Math.ceil(info.next.relative / 1000) }`);
                }
            }
            return info;
        });
    }

}

export interface BufferResult {
    buffer?: Buffer;
    existing?: UUID;
}