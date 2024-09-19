import { Router } from "express";
import { apiKeyMiddleware } from "../../middleware/apikey";
import { mineskinClientMiddleware } from "../../middleware/client";
import { breadcrumbMiddleware } from "../../middleware/breadcrumb";
import { v2GenerateFromUpload } from "../../models/v2/generate";

export const v2GenerateRouter = Router();


v2GenerateRouter.use("/", breadcrumbMiddleware);
v2GenerateRouter.use("/", apiKeyMiddleware);
v2GenerateRouter.use("/", mineskinClientMiddleware);


v2GenerateRouter.post("/upload", v2GenerateFromUpload);


