import { Response, Router } from "express";
import { v2GetSkin, v2SkinList } from "../../models/v2/skins";
import { v2Router } from "./router";
import expressAsyncHandler from "express-async-handler";
import { MineSkinV2Request } from "./types";
import { V2SkinListResponseBody } from "../../typings/v2/V2SkinListResponseBody";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { formatV2Response } from "../../middleware/response";
import { v2AddLike, v2AddView } from "../../models/v2/interactions";
import { wildcardCorsWithCredentials } from "../../middleware/cors";

const router: Router = v2Router();
router.use(wildcardCorsWithCredentials);

router.get("/", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinListResponseBody>) => {
    const result = await v2SkinList(req, res);
    res.json(formatV2Response(req, result));
}));

router.get("/:uuid", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinResponse>) => {
    const result = await v2GetSkin(req, res);
    res.json(formatV2Response(req, result));
}));

router.post("/:uuid/interactions/views", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinResponse>) => {
    await v2AddView(req, res);
    res.status(204).end();
}));

router.post("/:uuid/interactions/likes", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinResponse>) => {
    await v2AddLike(req, res);
    res.status(204).end();
}));


export const v2SkinsRouter: Router = router;