import { Router } from "express";
import { breadcrumbMiddleware } from "../../middleware/breadcrumb";
import { mineskinClientMiddleware } from "../../middleware/client";
import { mineskinUserMiddleware } from "../../middleware/user";
import { apiKeyMiddleware } from "../../middleware/apikey";
import { jwtMiddleware } from "../../middleware/jwt";

export function v2Router() {
    const router: Router = Router();

    router.use("/", breadcrumbMiddleware);
    router.use("/", apiKeyMiddleware);
    router.use("/", jwtMiddleware);
    router.use("/", mineskinClientMiddleware);
    router.use("/", mineskinUserMiddleware);

    return router;
}