import { Router } from "express";
import { v2Router } from "./router";
import expressAsyncHandler from "express-async-handler";
import { MineSkinV2Request } from "./types";
import { webOnlyCorsWithCredentials } from "../../middleware/cors";
import { formatV2Response } from "../../middleware/response";
import { v2GetUsageInfo } from "../../models/v2/usage";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";

const router: Router = v2Router();
router.use(webOnlyCorsWithCredentials);

router.use((req: MineSkinV2Request, res, next) => {
    res.header("Cache-Control", "private, no-store, max-age=5");
    next();
});

router.get("/", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    const usage = await v2GetUsageInfo(req, res);
    formatV2Response<V2MiscResponseBody>(req, {usage});
}));

export const v2UsageRouter: Router = router;