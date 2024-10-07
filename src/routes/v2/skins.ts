import { Router } from "express";
import { v2SkinList } from "../../models/v2/skins";
import { v2Router } from "./router";
import { v2ErrorHandler } from "../../models/v2/generate";

export const v2SkinsRouter: Router = v2Router();

v2SkinsRouter.get("/", v2SkinList);

v2SkinsRouter.use("/", v2ErrorHandler);


