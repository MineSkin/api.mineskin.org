import { Router } from "express";
import { mineSkinV2InitialMiddleware } from "../../middleware/combined";
import { corsMiddleware } from "../../util";

export function v2Router() {
    const router: Router = Router();

    router.use("/", corsMiddleware); //TODO: should ues the cors plugin from express

    router.use("/", mineSkinV2InitialMiddleware);

    return router;
}