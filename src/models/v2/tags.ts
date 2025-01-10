import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { V2ResponseBody } from "../../typings/v2/V2ResponseBody";
import { UUID } from "../../validation/misc";
import {
    IPopulatedSkin2Document,
    ISkinTagDocument,
    isPopulatedSkin2Document,
    Skin2,
    SkinTag
} from "@mineskin/database";
import { container } from "../../inversify.config";
import { Maybe, MineSkinError, SkinVisibility2, TagVoteType } from "@mineskin/types";
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
import { Classification } from "@mineskin/database/dist/schemas/Classification";

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

    // try {
    //     const aiPromise = requestAiTags(skin as IPopulatedSkin2Document).catch(e => {
    //         Sentry.captureException(e);
    //     });
    //     const updatedSkin = await timeout(aiPromise, 1000, 'request-ai-tags');
    //     if (updatedSkin) {
    //         skin = updatedSkin;
    //     }
    // } catch (e) {
    // }

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

    const tags = (skin.tags || [])
        .filter(t => t.votes >= threshold || userFilter(t))
        .map(t => ({
            tag: t.tag,
            vote: voteMapper(t),
            suggested: t.status === 'suggested',
        }));
    const tagNames = tags.map(t => t.tag);

    const hasAiTags = skin.tags && skin.tags.some(t => t.upvoters.includes(AI_TAG_USER));
    if (!hasAiTags) {
        try {
            if (isPopulatedSkin2Document(skin) && skin.data) {
                const classification = await Classification.findOne({
                    texture: skin.data.hash.skin.minecraft,
                    status: 'completed',
                    flagged: false
                }).exec();
                if (classification) {
                    // add suggested tags to this response
                    classification.tags
                        .filter(t => !tagNames.includes(t))
                        .forEach(t => {
                            tags.push({
                                tag: t,
                                vote: null,
                                suggested: true
                            });
                        });

                    // add suggested tags to the skin
                    let promises: Promise<boolean>[] = [];
                    for (let tag of classification.tags) {
                        promises.push(internalTagVote(skin, tag, TagVoteType.UP, AI_TAG_USER, false));
                    }
                    await Promise.all(promises);
                    await skin.save();
                }
            }
        } catch (e) {
            Sentry.captureException(e);
        }
    }

    return {
        success: true,
        tags: tags
    }
}

async function requestAiTags(skin: IPopulatedSkin2Document): Promise<Maybe<IPopulatedSkin2Document>> {
    try {
        if (!skin) return skin;
        if (!process.env.AI_TAG_ENDPOINT) return skin;
        if (skin.meta.visibility == SkinVisibility2.PRIVATE) return skin;
        const hasAiTags = skin.tags && skin.tags.some(t => t.upvoters.includes(AI_TAG_USER));
        if (hasAiTags) return skin;
        const texture = (skin as IPopulatedSkin2Document)?.data?.hash?.skin?.minecraft;
        if (!texture) return skin;
        const flags = container.get<IFlagProvider>(CoreTypes.FlagProvider);
        const [taggingEnabled, taggingChanceStr] = await Promise.all([
            flags.isEnabled('tags.ai_auto_tag'),
            flags.getValue('tags.ai_auto_tag')
        ]);
        if (!taggingEnabled) return skin;
        if (Math.random() > Number(taggingChanceStr)) return skin;
        Log.l.info(`Requesting AI tags for skin ${ skin.uuid }`);
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
            return skin;
        }
        const tags: string[] = (res.data.tags as string[])?.map(t => t.toLowerCase());
        if (!tags) return skin;
        Log.l.info(`Received AI tags for skin ${ skin.uuid }: ${ tags.join(', ') }`);

        skin = (await Skin2.findForUuid(skin.uuid)) as IPopulatedSkin2Document;
        if (!skin) return skin;
        let promises: Promise<boolean>[] = [];
        for (let tag of tags) {
            promises.push(internalTagVote(skin, tag, TagVoteType.UP, AI_TAG_USER, false));
        }
        await Promise.all(promises);
        return await skin.save();
    } catch (e) {
        Sentry.captureException(e);
    }
    return undefined;
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

    let skin = await Skin2.findForUuid(uuid);
    skin = validateRequestedSkin(req, skin);

    const added = await internalTagVote(skin as IPopulatedSkin2Document, tag, vote, userId);
    if (added) {
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
    } else {
        res.status(200).json({
            success: true,
            messages: [{code: "already_voted", message: "Already voted"}]
        });
    }

}

/**
 * @returns true if the vote was added, false if the user already voted
 */
async function internalTagVote(skin: IPopulatedSkin2Document, tag: string, vote: TagVoteType, userId: string, save: boolean = true): Promise<boolean> {
    tag = tag.toLowerCase().replace(/[^a-z- ]/g, ' ').trim();
    if (!skin.tags) {
        skin.tags = [];
    }
    let theTag = skin.tags.find(t => t.tag.toLowerCase() === tag);
    if (theTag) {
        if (vote === TagVoteType.UP && theTag.upvoters.includes(userId)) {
            return false;
        }
        if (vote === TagVoteType.DOWN && theTag.downvoters.includes(userId)) {
            return false;
        }
    }
    if (!theTag) {
        theTag = new SkinTag({
            tag: tag,
            votes: vote === TagVoteType.UP ? 1 : -1,
            upvoters: vote === TagVoteType.UP ? [userId] : [],
            downvoters: vote === TagVoteType.DOWN ? [userId] : [],
            status: userId === AI_TAG_USER ? 'suggested' : 'pending'
        });
        skin.tags.push(theTag);
    } else {
        if (vote === TagVoteType.UP) {
            theTag.votes++;
            theTag.upvoters.push(userId);
            theTag.downvoters = theTag.downvoters.filter(u => u !== userId);
        } else {
            theTag.votes--;
            theTag.downvoters.push(userId);
            theTag.upvoters = theTag.upvoters.filter(u => u !== userId);
        }
        if (theTag.status === 'suggested') {
            theTag.status = 'pending';
        } else if (userId === AI_TAG_USER) {
            theTag.status = 'suggested';
        }
    }
    if (save) {
        await skin.save();
    }
    return true;
}