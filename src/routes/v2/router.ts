import { Router } from "express";
import { mineSkinV2InitialMiddleware } from "../../middleware/combined";
import { mineskinOnlyCors } from "../../middleware/cors";
import helmet from "helmet";

export function v2Router() {
    const router: Router = Router();

    router.use(mineskinOnlyCors);
    router.use(helmet())

    router.use(mineSkinV2InitialMiddleware);

    return router;
}