import { Response, Router } from "express";
import { v2Router } from "./router";
import expressAsyncHandler from "express-async-handler";
import { v2GetClientInfo, v2GetCreditsInfo, v2GetKeyInfo, v2GetMe, v2ListKeys } from "../../models/v2/me";
import { MineSkinV2Request } from "./types";
import { webOnlyCorsWithCredentials } from "../../middleware/cors";
import { V2SkinListResponseBody } from "../../typings/v2/V2SkinListResponseBody";
import { v2UserLegacySkinList, v2UserSkinList } from "../../models/v2/skins";
import { formatV2Response } from "../../middleware/response";

const router: Router = v2Router();
router.use(webOnlyCorsWithCredentials);

router.use((req: MineSkinV2Request, res, next) => {
    res.header("Cache-Control", "private, no-store, max-age=0");
    next();
});

router.get("/", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetMe(req, res);
}));

router.get("/apikeys", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2ListKeys(req, res);
}));

router.get("/apikey", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetKeyInfo(req, res);
}));

router.get("/client", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetClientInfo(req, res);
}));

router.get("/credits", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetCreditsInfo(req, res);
}));


router.get("/skins", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinListResponseBody>) => {
    const result = await v2UserSkinList(req, res);
    res.json(formatV2Response(req, result));
}));

router.get("/legacyskins", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinListResponseBody>) => {
    const result = await v2UserLegacySkinList(req, res);
    res.json(formatV2Response(req, result));
}));

export const v2MeRouter: Router = router;