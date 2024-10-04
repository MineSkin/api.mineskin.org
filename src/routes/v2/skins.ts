import { Router } from "express";
import { breadcrumbMiddleware } from "../../middleware/breadcrumb";
import { apiKeyMiddleware } from "../../middleware/apikey";
import { mineskinClientMiddleware } from "../../middleware/client";
import { v2SkinList } from "../../models/v2/skins";

export const v2SkinsRouter: Router = Router();


v2SkinsRouter.use("/", breadcrumbMiddleware);
v2SkinsRouter.use("/", apiKeyMiddleware);
v2SkinsRouter.use("/", mineskinClientMiddleware);


v2SkinsRouter.get("/", v2SkinList);


