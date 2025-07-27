import { z } from "zod"
import { SkinVariant, SkinVisibility2 } from "@mineskin/types";
import { UUID } from "./misc";

export const URL_MAX_LENGTH = 256;
export const BASE64_MAX_LENGTH = 26668; // roughly 20KB encoded PNG

export const GenerateReqName = z.string().max(48).regex(/^[a-zA-Z0-9_.\- ]+$/);
export const GenerateReqVisibility = z.enum([SkinVisibility2.PUBLIC, SkinVisibility2.UNLISTED, SkinVisibility2.PRIVATE]);

export const GenerateReqNameAndVisibility = z.object({
    name: GenerateReqName.optional(),
    visibility: GenerateReqVisibility.optional()
});

export const GenerateReqOptions = z.object({
    name: GenerateReqName.optional(),
    visibility: GenerateReqVisibility.default(SkinVisibility2.PUBLIC),
    variant: z.enum([SkinVariant.CLASSIC, SkinVariant.SLIM, SkinVariant.UNKNOWN]).default(SkinVariant.UNKNOWN),
    cape: UUID.optional()
});

export const GenerateReqUrlHttp = GenerateReqOptions.extend({
    url: z.string().min(1).max(URL_MAX_LENGTH).regex(/^(http|https):\/\//)
});
export const GenerateReqUrlBase64 = GenerateReqOptions.extend({
    url: z.string().min(1).max(BASE64_MAX_LENGTH).regex(/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/)
});
export const GenerateReqUrl = GenerateReqUrlHttp.or(GenerateReqUrlBase64);

export const GenerateReqUser = GenerateReqOptions.extend({
    user: UUID
});

export const GenerateReq = GenerateReqOptions.or(GenerateReqUrl).or(GenerateReqUser);

export const GenerateTimeout = z.coerce.number().int().positive().max(30).default(10);

export type GenerateReqOptions = z.infer<typeof GenerateReqOptions>;
export type GenerateReqUrl = z.infer<typeof GenerateReqUrl>;
export type GenerateReqUser = z.infer<typeof GenerateReqUser>;
export type GenerateReq = z.infer<typeof GenerateReq>;