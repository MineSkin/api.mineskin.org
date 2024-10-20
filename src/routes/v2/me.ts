import { Response, Router } from "express";
import { v2Router } from "./router";
import expressAsyncHandler from "express-async-handler";
import { v2GetClientInfo, v2GetCreditsInfo, v2GetKeyInfo, v2GetMe, v2ListKeys } from "../../models/v2/me";
import { MineSkinV2Request } from "./types";
import { v2ErrorHandler } from "../../middleware/error";
import { webOnlyCorsWithCredentials } from "../../middleware/cors";
import { V2SkinListResponseBody } from "../../typings/v2/V2SkinListResponseBody";
import { v2UserSkinList } from "../../models/v2/skins";
import { formatV2Response } from "../../middleware/response";

export const v2MeRouter: Router = v2Router();
v2MeRouter.use(webOnlyCorsWithCredentials);

v2MeRouter.use((req: MineSkinV2Request, res, next) => {
    res.header("Cache-Control", "private, no-store, max-age=0");
    next();
});

v2MeRouter.get("/", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetMe(req, res);
}));

v2MeRouter.get("/apikeys", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2ListKeys(req, res);
}));

v2MeRouter.get("/apikey", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetKeyInfo(req, res);
}));

v2MeRouter.get("/client", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetClientInfo(req, res);
}));

v2MeRouter.get("/credits", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetCreditsInfo(req, res);
}));


v2MeRouter.get("/skins", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinListResponseBody>) => {
    const result = await v2UserSkinList(req, res);
    res.json(formatV2Response(req, result));
}));


v2MeRouter.use("/", v2ErrorHandler);