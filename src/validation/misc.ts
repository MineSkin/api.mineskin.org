import { z } from "zod";

export const UUID = z.string().regex(/^[a-f0-9]+$/).length(32).or(z.string().regex(/^[a-f0-9\-]+$/).length(36));