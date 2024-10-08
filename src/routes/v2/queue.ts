import { Response, Router } from "express";
import { v2ErrorHandler, v2GenerateEnqueue, v2GetJob } from "../../models/v2/generate";
import { v2GenerateRouter } from "./generate";
import { v2Router } from "./router";
import expressAsyncHandler from "express-async-handler";
import { GenerateV2Request } from "./types";
import { V2JobResponse } from "../../typings/v2/V2JobResponse";

export const v2QueueRouter: Router = v2Router();

v2QueueRouter.post("/", expressAsyncHandler(async (req: GenerateV2Request, res: Response<V2JobResponse>) => {
    const result = await v2GenerateEnqueue(req, res);
    res.json(result);
}));
v2QueueRouter.get("/:jobId", expressAsyncHandler(async (req: GenerateV2Request, res: Response<V2JobResponse>) => {
    const result = await v2GetJob(req, res);
    res.json(result);
}));

v2GenerateRouter.use("/", v2ErrorHandler);