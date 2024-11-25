import { z } from "zod";

export const ReportReqBody = z.object({
    reason: z.enum(['skin', 'name', 'tags'])
})

export type ReportReqBody = z.infer<typeof ReportReqBody>;