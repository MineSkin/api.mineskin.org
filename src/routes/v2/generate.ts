import { Router } from "express";
import { apiKeyMiddleware } from "../../middleware/apikey";
import { mineskinClientMiddleware } from "../../middleware/client";
import { breadcrumbMiddleware } from "../../middleware/breadcrumb";
import { v2ErrorHandler, v2GenerateAndWait } from "../../models/v2/generate";

export const v2GenerateRouter: Router = Router();

v2GenerateRouter.use("/", breadcrumbMiddleware);
v2GenerateRouter.use("/", apiKeyMiddleware);
v2GenerateRouter.use("/", mineskinClientMiddleware);


v2GenerateRouter.post("/", v2GenerateAndWait);

v2GenerateRouter.use("/", v2ErrorHandler);