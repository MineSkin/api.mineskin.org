import { Response, Router } from "express";
import { v2Router } from "./router";
import { wildcardCors } from "../../middleware/cors";
import expressAsyncHandler from "express-async-handler";
import { MineSkinV2Request } from "./types";
import { V2SkinResponse } from "../../typings/v2/V2SkinResponse";
import { v2GetImage } from "../../models/v2/images";

const router: Router = v2Router();
router.use(wildcardCors);

router.get("/:hash", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2SkinResponse>) => {
    res.header('Cache-Control', 'public, max-age=31536000');
    await v2GetImage(req, res);
}));

export const v2ImagesRouter: Router = router;