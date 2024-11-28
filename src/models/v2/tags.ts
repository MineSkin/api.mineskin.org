import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { V2ResponseBody } from "../../typings/v2/V2ResponseBody";
import { UUID } from "../../validation/misc";
import { IPopulatedSkin2Document, ISkinTagDocument, Skin2, SkinTag } from "@mineskin/database";
import { container } from "../../inversify.config";
import { MineSkinError, TagVoteType } from "@mineskin/types";
import { TagVoteReqBody } from "../../validation/tags";
import { SkinService, TYPES as GeneratorTypes } from "@mineskin/generator";
import * as Sentry from "@sentry/node";
import { IFlagProvider, IMetricsProvider } from "@mineskin/core";
import { TYPES as CoreTypes } from "@mineskin/core/dist/ditypes";
import { HOSTNAME } from "../../util/host";
import { verifyTurnstileToken } from "../../util/turnstile";
import { getIp } from "../../util";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { validateRequestedSkin } from "./skins";
import { Requests } from "../../generator/Requests";
import { Log } from "../../Log";

const AI_TAG_USER = "78cd4d0a343846db8f14521892452389";

export async function getSkinTags(req: MineSkinV2Request, res: Response<V2ResponseBody>): Promise<V2MiscResponseBody> {
    const uuid = UUID.parse(req.params.uuid);

    let skin = await container.get<SkinService>(GeneratorTypes.SkinService).findForUuid(uuid);
    skin = validateRequestedSkin(req, skin);

    const flags = container.get<IFlagProvider>(CoreTypes.FlagProvider);
    const threshold = Number(await flags.getValue('tags.vote_threshold.visible'));

    if (!skin.tags) {
        skin.tags = [];
    }

    requestAiTags(skin as IPopulatedSkin2Document).catch(e => {
        Sentry.captureException(e);
    });

    const userFilter: (tag: ISkinTagDocument) => boolean = t => !!req.client.userId &&
        (t.upvoters.includes(req.client.userId) || t.downvoters.includes(req.client.userId));
    const voteMapper = (tag: ISkinTagDocument): TagVoteType | null => {
        if (!req.client.userId) {
            return null;
        }
        if (tag.upvoters.includes(req.client.userId)) {
            return TagVoteType.UP;
        }
        if (tag.downvoters.includes(req.client.userId)) {
            return TagVoteType.DOWN;
        }
        return null;
    }

    return {
        success: true,
        tags: skin.tags
            .filter(t => t.votes >= threshold || userFilter(t))
            .map(t => ({
                tag: t.tag,
                vote: voteMapper(t)
            }))
    }
}

async function requestAiTags(skin: IPopulatedSkin2Document) {
    try {
        if (!skin) return;
        if (!process.env.AI_TAG_ENDPOINT) return;
        const hasAiTags = skin.tags && skin.tags.some(t => t.upvoters.includes(AI_TAG_USER));
        if (hasAiTags) return;
        const texture = (skin as IPopulatedSkin2Document)?.data?.hash?.skin?.minecraft;
        if (!texture) return;
        const flags = container.get<IFlagProvider>(CoreTypes.FlagProvider);
        const [taggingEnabled, taggingChanceStr] = await Promise.all([
            flags.isEnabled('tags.ai_auto_tag'),
            flags.getValue('tags.ai_auto_tag')
        ]);
        if (!taggingEnabled) return;
        if (Math.random() > Number(taggingChanceStr)) return;
        const res = await Requests.genericRequest({
            method: 'GET',
            url: process.env.AI_TAG_ENDPOINT,
            params: {
                texture: texture
            }
        });
        if (!Requests.isOk(res)) {
            Log.l.warn(`Failed to request AI tags for skin ${ skin.uuid }`);
            if (res.data) {
                Log.l.warn(res.data);
            }
            return;
        }
        const tags: string[] = res.data.tags;
        if (!tags) return;
        Log.l.info(`Received AI tags for skin ${ skin.uuid }: ${ tags.join(', ') }`);

        const tagObjects = tags
            .filter(t => !skin.tags?.some(st => st.tag === t))
            .map(t => ({
                tag: t,
                votes: 1,
                upvoters: [AI_TAG_USER],
                downvoters: [],
                status: 'suggested'
            }));
        await Skin2.updateOne({uuid: skin.uuid}, {
            $push: {
                tags: {
                    $each: tagObjects,
                    $position: 0
                }
            }
        }).exec();
    } catch (e) {
        Sentry.captureException(e);
    }
}

export async function addSkinTagVote(req: MineSkinV2Request, res: Response<V2ResponseBody>) {
    const uuid = UUID.parse(req.params.uuid);
    if (!req.client.hasUser()) {
        throw new MineSkinError('unauthorized', "Unauthorized", {httpCode: 401});
    }
    const userId = req.client.userId!;
    const {tag, vote} = TagVoteReqBody.parse(req.body);

    const valid = await verifyTurnstileToken(req.header('Turnstile-Token'), getIp(req));
    if (!valid) {
        throw new MineSkinError('unauthorized', "Invalid Turnstile Token", {httpCode: 401});
    }

    let skin = await container.get<SkinService>(GeneratorTypes.SkinService).findForUuid(uuid);
    skin = validateRequestedSkin(req, skin);

    if (!skin.tags) {
        skin.tags = [];
    }
    let theTag = skin.tags.find(t => t.tag === tag);
    if (theTag) {
        if (vote === TagVoteType.UP && theTag.upvoters.includes(userId)) {
            res.status(204).end();
            return;
        }
        if (vote === TagVoteType.DOWN && theTag.downvoters.includes(userId)) {
            res.status(204).end();
            return;
        }
    }
    if (!theTag) {
        theTag = new SkinTag({
            tag: tag,
            votes: 0,
            upvoters: [],
            downvoters: []
        });
        skin.tags.push(theTag);
    }
    if (vote === TagVoteType.UP) {
        theTag.votes++;
        theTag.upvoters.push(userId);
        theTag.downvoters = theTag.downvoters.filter(u => u !== req.client.userId);
    } else {
        theTag.votes--;
        theTag.downvoters.push(userId);
        theTag.upvoters = theTag.upvoters.filter(u => u !== req.client.userId);
    }
    skin.markModified('tags');
    await skin.save();
    res.status(200).json({
        success: true,
        messages: [{code: "vote_added", message: "Vote added successfully"}]
    });
    try {
        const metrics = container.get<IMetricsProvider>(CoreTypes.MetricsProvider);
        metrics.getMetric('skin_tags')
            .tag("server", HOSTNAME)
            .tag("vote", vote)
            .inc();
    } catch (e) {
        Sentry.captureException(e);
    }
}