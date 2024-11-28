import { Router } from "express";
import { v2Router } from "./router";
import expressAsyncHandler from "express-async-handler";
import { MineSkinV2Request } from "./types";
import { formatV2Response } from "../../middleware/response";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { v2GetStats } from "../../models/v2/stats";
import { wildcardCors } from "../../middleware/cors";

const router: Router = v2Router();
router.use(wildcardCors);

router.get("/", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    const resp = await v2GetStats(req, res);
    formatV2Response<V2MiscResponseBody>(req, resp);
}));

export const v2StatsRouter: Router = router;