import { Router } from "express";
import { breadcrumbMiddleware } from "../../middleware/breadcrumb";
import { apiKeyMiddleware } from "../../middleware/apikey";
import { mineskinClientMiddleware } from "../../middleware/client";
import { mineskinUserMiddleware } from "../../middleware/user";

export function v2Router() {
    const router: Router = Router();

    router.use("/", breadcrumbMiddleware);
    router.use("/", apiKeyMiddleware);
    router.use("/", mineskinClientMiddleware);
    router.use("/", mineskinUserMiddleware);

    return router;
}