import { Router } from "express";
import { v2ErrorHandler, v2GenerateEnqueue, v2GetJob } from "../../models/v2/generate";
import { v2GenerateRouter } from "./generate";
import { v2Router } from "./router";

export const v2QueueRouter: Router = v2Router();

v2QueueRouter.post("/", v2GenerateEnqueue);
v2QueueRouter.get("/:jobId", v2GetJob);

v2GenerateRouter.use("/", v2ErrorHandler);