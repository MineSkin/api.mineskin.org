import { Response, Router } from "express";
import {
    v2GetSkin,
    v2GetSkinTextureRedirect,
    v2LatestSkinList,
    v2ListRandomSkins,
    v2PopularSkinList
} from "../../models/v2/skins";
import { v2Router } from "./router";
import expressAsyncHandler from "express-async-handler";
import { MineSkinV2Request } from "./types";
import { V2SkinListResponseBody } from "../../typings/v2/V2SkinListResponseBody";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { formatV2Response } from "../../middleware/response";
import { v2AddLike, v2AddView, v2ReportSkin } from "../../models/v2/interactions";
import { wildcardCorsWithCredentials } from "../../middleware/cors";
import { addSkinTagVote, getSkinTags } from "../../models/v2/tags";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { getSkinMeta } from "../../models/v2/meta";

const router: Router = v2Router();
router.use(wildcardCorsWithCredentials);

// alias of /latest
router.get("/", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinListResponseBody>) => {
    const result = await v2LatestSkinList(req, res);
    res.header('Cache-Control', 'public, max-age=3600');
    res.json(formatV2Response(req, result));
}));

router.get("/latest", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinListResponseBody>) => {
    const result = await v2LatestSkinList(req, res);
    res.header('Cache-Control', 'public, max-age=3600');
    res.json(formatV2Response(req, result));
}));

router.get("/popular", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinListResponseBody>) => {
    const result = await v2PopularSkinList(req, res);
    res.header('Cache-Control', 'public, max-age=3600');
    res.json(formatV2Response(req, result));
}));

router.get("/random", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinListResponseBody>) => {
    const result = await v2ListRandomSkins(req, res);
    res.header('Cache-Control', 'public, max-age=3600');
    res.json(formatV2Response(req, result));
}));

router.get("/:uuid", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinResponse>) => {
    const result = await v2GetSkin(req, res);
    res.header('Cache-Control', 'public, max-age=10800');
    res.json(formatV2Response(req, result));
}));

router.get("/:uuid/texture", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinResponse>) => {
    await v2GetSkinTextureRedirect(req, res);
}));

router.post("/:uuid/interactions/views", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2MiscResponseBody>) => {
    await v2AddView(req, res);
    res.status(204).end();
}));

router.post("/:uuid/interactions/likes", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2MiscResponseBody>) => {
    await v2AddLike(req, res);
    res.status(204).end();
}));

router.get("/:uuid/tags", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2MiscResponseBody>) => {
    const result = await getSkinTags(req, res);
    res.header('Cache-Control', 'public, max-age=60');
    res.json(formatV2Response(req, result));
}));

router.post("/:uuid/tags", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2MiscResponseBody>) => {
    await addSkinTagVote(req, res);
    res.status(204).end();
}));

router.get("/:uuid/meta", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2MiscResponseBody>) => {
    const result = await getSkinMeta(req, res);
    res.header('Cache-Control', 'public, max-age=3600');
    res.json(formatV2Response(req, result));
}));

router.post("/:uuid/report", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2MiscResponseBody>) => {
    await v2ReportSkin(req, res);
    res.status(200).json(formatV2Response(req, {
        success: true,
        messages: [{code: "reported", message: "Skin reported successfully"}]
    }));
}));


export const v2SkinsRouter: Router = router;