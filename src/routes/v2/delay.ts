import { Router } from "express";
import { v2Router } from "./router";
import { MineSkinV2Request } from "./types";
import { v2ErrorHandler } from "../../middleware/error";
import expressAsyncHandler from "express-async-handler";
import { v2GetDelay } from "../../models/v2/delay";

export const v2DelayRouter: Router = v2Router();

v2DelayRouter.use((req: MineSkinV2Request, res, next) => {
    res.header("Cache-Control", "private, no-store, max-age=1");
    next();
});

v2DelayRouter.get("/", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetDelay(req, res);
}));

v2DelayRouter.use("/", v2ErrorHandler);