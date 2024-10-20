import { z } from "zod"
import { SkinVariant, SkinVisibility2 } from "@mineskin/types";
import { UUID } from "./misc";

export const GenerateReqOptions = z.object({
    name: z.string().max(20).regex(/^[a-zA-Z0-9_.\- ]+$/).optional(),
    visibility: z.enum([SkinVisibility2.PUBLIC, SkinVisibility2.UNLISTED, SkinVisibility2.PRIVATE]).default(SkinVisibility2.PUBLIC),
    variant: z.enum([SkinVariant.CLASSIC, SkinVariant.SLIM, SkinVariant.UNKNOWN]).default(SkinVariant.UNKNOWN)
});

export const GenerateReqUrl = GenerateReqOptions.extend({
    url: z.string().min(1).max(256).regex(/^(http|https):\/\//)
});

export const GenerateReqUser = GenerateReqOptions.extend({
    user: UUID
});

export const GenerateReq = GenerateReqOptions.or(GenerateReqUrl).or(GenerateReqUser);

export type GenerateReqOptions = z.infer<typeof GenerateReqOptions>;
export type GenerateReqUrl = z.infer<typeof GenerateReqUrl>;
export type GenerateReqUser = z.infer<typeof GenerateReqUser>;
export type GenerateReq = z.infer<typeof GenerateReq>;