import { Response, Router } from "express";
import { v2GetSkin, v2SkinList } from "../../models/v2/skins";
import { v2Router } from "./router";
import { v2ErrorHandler } from "../../models/v2/generate";
import expressAsyncHandler from "express-async-handler";
import { MineSkinV2Request } from "./types";
import { V2SkinListResponseBody } from "../../typings/v2/V2SkinListResponseBody";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";

export const v2SkinsRouter: Router = v2Router();

v2SkinsRouter.get("/", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinListResponseBody>) => {
    const result = await v2SkinList(req, res);
    res.json(result);
}));

v2SkinsRouter.get("/:uuid", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinResponse>) => {
    const result = await v2GetSkin(req, res);
    res.json(result);
}));

v2SkinsRouter.use("/", v2ErrorHandler);


