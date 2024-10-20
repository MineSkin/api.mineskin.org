import { Router } from "express";
import { v2Router } from "./router";
import { MineSkinV2Request } from "./types";
import expressAsyncHandler from "express-async-handler";
import { v2GetDelay } from "../../models/v2/delay";
import { wildcardCorsWithCredentials } from "../../middleware/cors";

export const router: Router = v2Router();
router.use(wildcardCorsWithCredentials);

router.use((req: MineSkinV2Request, res, next) => {
    res.header("Cache-Control", "private, no-store, max-age=1");
    next();
});

router.get("/", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetDelay(req, res);
}));

export const v2DelayRouter: Router = router;