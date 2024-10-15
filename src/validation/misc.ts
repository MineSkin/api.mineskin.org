import { z } from "zod";

export const UUID = z.string().regex(/^[a-f0-9]+$/).length(32).or(z.string().regex(/^[a-f0-9\-]+$/).length(36));

const Sha256Full = z.string().regex(/^[a-f0-9]+$/).length(64);
const Sha256Trimmed = z.string().regex(/^[a-f0-9]+$/).length(63).optional();
export const Sha256 = Sha256Full.or(Sha256Trimmed);