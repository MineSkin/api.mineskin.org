import { Router } from "express";
import { v2Router } from "./router";
import expressAsyncHandler from "express-async-handler";
import { v2GetClientInfo, v2GetCreditsInfo, v2GetKeyInfo, v2GetMe } from "../../models/v2/me";
import { MineSkinV2Request } from "./types";
import { v2ErrorHandler } from "../../middleware/error";
import { webOnlyCorsWithCredentials } from "../../middleware/cors";

export const v2MeRouter: Router = v2Router();
v2MeRouter.use(webOnlyCorsWithCredentials);

v2MeRouter.use((req: MineSkinV2Request, res, next) => {
    res.header("Cache-Control", "private, no-store, max-age=0");
    next();
});

v2MeRouter.get("/", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetMe(req, res);
}));

v2MeRouter.get("/apikey", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetKeyInfo(req, res);
}));

v2MeRouter.get("/client", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetClientInfo(req, res);
}));

v2MeRouter.get("/credits", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetCreditsInfo(req, res);
}));


v2MeRouter.use("/", v2ErrorHandler);