import { Router } from "express";
import { mineSkinV2InitialMiddleware } from "../../middleware/combined";

export function v2Router() {
    const router: Router = Router();

    router.use("/", mineSkinV2InitialMiddleware);

    return router;
}