import { Response, Router } from "express";
import { v2Router } from "./router";
import { wildcardCors } from "../../middleware/cors";
import expressAsyncHandler from "express-async-handler";
import { MineSkinV2Request } from "./types";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { v2ErrorHandler } from "../../middleware/error";
import { v2GetImage } from "../../models/v2/images";

export const v2ImagesRouter: Router = v2Router();
v2ImagesRouter.use(wildcardCors);

v2ImagesRouter.get("/:hash", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinResponse>) => {
    res.header('Cache-Control', 'public, max-age=31536000');
    await v2GetImage(req, res);
}));

v2ImagesRouter.use("/", v2ErrorHandler);

