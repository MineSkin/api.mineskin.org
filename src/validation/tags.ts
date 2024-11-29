import { z } from "zod";
import { TagVoteType } from "@mineskin/types";

export const TagVoteReqBody = z.object({
    tag: z.string().min(1).max(32).regex(/^[a-z- ]+$/),
    vote: z.enum([TagVoteType.UP, TagVoteType.DOWN])
})

export type TagVoteReqBody = z.infer<typeof TagVoteReqBody>;