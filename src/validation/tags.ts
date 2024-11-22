import { z } from "zod";
import { TagVoteType } from "../typings/TagVoteType";

export const TagVoteReqBody = z.object({
    tag: z.string().min(1).max(32).regex(/^[a-z0-9-_ ]+$/),
    vote: z.enum([TagVoteType.UP, TagVoteType.DOWN])
})

export type TagVoteReqBody = z.infer<typeof TagVoteReqBody>;