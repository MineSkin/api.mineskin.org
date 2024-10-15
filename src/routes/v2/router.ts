import { Router } from "express";
import { mineSkinV2InitialMiddleware } from "../../middleware/combined";
import helmet from "helmet";

export function v2Router() {
    const router: Router = Router();

    router.use(helmet())

    router.use(mineSkinV2InitialMiddleware);

    return router;
}