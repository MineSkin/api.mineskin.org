import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { V2ResponseBody } from "../../typings/v2/V2ResponseBody";
import { UUID } from "../../validation/misc";
import { isPopulatedSkin2Document, SkinTag } from "@mineskin/database";
import { container } from "../../inversify.config";
import { MineSkinError, SkinVisibility2, TagVoteType } from "@mineskin/types";
import { TagVoteReqBody } from "../../validation/tags";
import { SkinService, TYPES as GeneratorTypes } from "@mineskin/generator";
import * as Sentry from "@sentry/node";
import { IMetricsProvider } from "@mineskin/core";
import { TYPES as CoreTypes } from "@mineskin/core/dist/ditypes";
import { HOSTNAME } from "../../util/host";
import { verifyTurnstileToken } from "../../util/turnstile";
import { getIp } from "../../util";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";

export async function getSkinTags(req: MineSkinV2Request, res: Response<V2ResponseBody>): Promise<V2MiscResponseBody> {
    const uuid = UUID.parse(req.params.uuid);

    const skin = await container.get<SkinService>(GeneratorTypes.SkinService).findForUuid(uuid);
    if (!skin || !isPopulatedSkin2Document(skin)) {
        throw new MineSkinError('skin_not_found', 'Skin not found', {httpCode: 404});
    }

    if (skin.meta.visibility === SkinVisibility2.PRIVATE) {
        const usersMatch = req.client.userId && skin.clients.some(c => c.user === req.client.userId);
        if (!usersMatch) {
            throw new MineSkinError('skin_not_found', 'Skin not found', {httpCode: 404});
        }
    }

    if (!skin.tags) {
        skin.tags = [];
    }

    return {
        success: true,
        tags: skin.tags.map(t => ({tag: t.tag}))
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

    const skin = await container.get<SkinService>(GeneratorTypes.SkinService).findForUuid(uuid);
    if (!skin || !isPopulatedSkin2Document(skin)) {
        throw new MineSkinError('skin_not_found', 'Skin not found', {httpCode: 404});
    }

    if (skin.meta.visibility === SkinVisibility2.PRIVATE) {
        const usersMatch = skin.clients.some(c => c.user === userId);
        if (!usersMatch) {
            throw new MineSkinError('skin_not_found', 'Skin not found', {httpCode: 404});
        }
    }

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