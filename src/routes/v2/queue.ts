import { Router } from "express";
import { apiKeyMiddleware } from "../../middleware/apikey";
import { mineskinClientMiddleware } from "../../middleware/client";
import { breadcrumbMiddleware } from "../../middleware/breadcrumb";
import { v2ErrorHandler, v2GenerateEnqueue, v2GetJob } from "../../models/v2/generate";
import { v2GenerateRouter } from "./generate";

export const v2QueueRouter: Router = Router();

v2QueueRouter.use("/", breadcrumbMiddleware);
v2QueueRouter.use("/", apiKeyMiddleware);
v2QueueRouter.use("/", mineskinClientMiddleware);


v2QueueRouter.post("/", v2GenerateEnqueue);
v2QueueRouter.get("/:jobId", v2GetJob);

v2GenerateRouter.use("/", v2ErrorHandler);