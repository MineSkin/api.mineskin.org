import { Response, Router } from "express";
import { v2Router } from "./router";
import expressAsyncHandler from "express-async-handler";
import { MineSkinV2Request } from "./types";
import { wildcardCors } from "../../middleware/cors";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { listKnownCapes } from "../../models/v2/capes";
import { formatV2Response } from "../../middleware/response";

const router: Router = v2Router();
router.use(wildcardCors);

// alias of /latest
router.get("/", expressAsyncHandler(async (req: MineSkinV2Request, res: Response<V2MiscResponseBody>) => {
    const result = await listKnownCapes(req, res);
    res.header('Cache-Control', 'public, max-age=3600');
    res.json(formatV2Response(req, result));
}));

export const v2CapesRouter: Router = router;