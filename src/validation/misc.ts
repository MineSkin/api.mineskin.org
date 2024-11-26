import { z } from "zod";

export const UUIDShort = z.string().length(32).regex(/^[a-f0-9]+$/);
export const UUIDLong = z.string().length(36).regex(/^[a-f0-9\-]+$/);
export const UUID = UUIDShort.or(UUIDLong);
export const ObjectId = z.string().length(24).regex(/^[a-f0-9]+$/);
export const ShortId = z.string().length(8).regex(/^[a-f0-9]+$/);

export const UUIDOrShortId = UUID.or(ShortId);

const Sha256Full = z.string().regex(/^[a-f0-9]+$/).length(64);
const Sha256Trimmed = z.string().regex(/^[a-f0-9]+$/).length(63).optional();
export const Sha256 = Sha256Full.or(Sha256Trimmed);