import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { V2ResponseBody } from "../../typings/v2/V2ResponseBody";
import { UUID } from "../../validation/misc";
import { ISkinTagDocument, isPopulatedSkin2Document } from "@mineskin/database";
import { container } from "../../inversify.config";
import { MineSkinError, SkinVisibility2 } from "@mineskin/types";
import { TagVoteReqBody } from "../../validation/tags";
import { SkinService } from "@mineskin/generator";
import { TYPES as GeneratorTypes } from "@mineskin/generator/dist/ditypes";
import { TagVoteType } from "../../typings/TagVoteType";

export async function addSkinTagVote(req: MineSkinV2Request, res: Response<V2ResponseBody>) {
    const uuid = UUID.parse(req.params.uuid);
    if (!req.client.hasUser()) {
        throw new MineSkinError('unauthorized', "Unauthorized", {httpCode: 401});
    }
    const {tag, vote} = TagVoteReqBody.parse(req.body);

    const skin = await container.get<SkinService>(GeneratorTypes.SkinService).findForUuid(uuid);
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

    if (!skin.tags) {
        skin.tags = [];
    }
    let theTag: ISkinTagDocument = skin.tags.find(t => t.tag === tag);
    if (theTag) {
        if (vote === TagVoteType.UP && theTag.upvoters.includes(req.client.userId)) {
            res.status(204).json({
                messages: [{code: "already_voted", message: "You already upvoted for this tag"}]
            });
            return;
        }
        if (vote === TagVoteType.DOWN && theTag.downvoters.includes(req.client.userId)) {
            res.status(204).json({
                messages: [{code: "already_voted", message: "You already downvoted for this tag"}]
            });
            return;
        }
    }
    if (!theTag) {
        theTag = {
            tag: tag,
            votes: 0,
            upvoters: [],
            downvoters: []
        } as ISkinTagDocument;
    }
    if (vote === TagVoteType.UP) {
        theTag.votes++;
        theTag.upvoters.push(req.client.userId);
        theTag.downvoters = theTag.downvoters.filter(u => u !== req.client.userId);
    } else {
        theTag.votes--;
        theTag.downvoters.push(req.client.userId);
        theTag.upvoters = theTag.upvoters.filter(u => u !== req.client.userId);
    }
    await skin.save();
    res.status(200).json({
        messages: [{code: "vote_added", message: "Vote added successfully"}]
    });
}