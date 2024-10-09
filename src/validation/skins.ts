import { z } from "zod";
import { UUID } from "./misc";

export const ListReqSize = z.coerce.number().min(1).max(128).default(16);
export const ListReqAfter = UUID.optional();
export const ListReqFilter = z.string().min(1).max(32).regex(/^[a-z0-9-_ ]+$/).optional();

export const ListReqQuery = z.object({
    after: ListReqAfter,
    size: ListReqSize,
    filter: ListReqFilter
});

export type ListReqSize = z.infer<typeof ListReqSize>;
export type ListReqAfter = z.infer<typeof ListReqAfter>;
export type ListReqFilter = z.infer<typeof ListReqFilter>;

export type ListReqQuery = z.infer<typeof ListReqQuery>;