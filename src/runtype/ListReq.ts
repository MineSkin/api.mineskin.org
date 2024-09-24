import { Literal, Number, Record, Static, String } from "runtypes";
import { UUID } from "./misc";

export const ListReqSize = Number.withConstraint(n => n > 0 && n <= 128).Or(Literal(16));
export const ListReqAfter = UUID.optional();
export const ListReqFilter = String.withConstraint(s => s.length > 0 && s.length < 32).withConstraint(s => /[a-z0-9-_]/.test(s)).optional();

export const ListReqQuery = Record({
    after: ListReqAfter,
    size: ListReqSize,
    filter: ListReqFilter
});

export type ListReqSize = Static<typeof ListReqSize>;
export type ListReqAfter = Static<typeof ListReqAfter>;
export type ListReqFilter = Static<typeof ListReqFilter>;

export type ListReqQuery = Static<typeof ListReqQuery>;