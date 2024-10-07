import { Router } from "express";
import { breadcrumbMiddleware } from "../../middleware/breadcrumb";
import { apiKeyMiddleware } from "../../middleware/apikey";
import { mineskinClientMiddleware } from "../../middleware/client";

export function v2Router() {
    const router: Router = Router();

    router.use("/", breadcrumbMiddleware);
    router.use("/", apiKeyMiddleware);
    router.use("/", mineskinClientMiddleware);

    return router;
}