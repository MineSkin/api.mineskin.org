import { Router } from "express";
import { v2Router } from "./router";
import expressAsyncHandler from "express-async-handler";
import { v2GetClientInfo, v2GetKeyInfo, v2GetMe } from "../../models/v2/me";
import { MineSkinV2Request } from "./types";

export const v2MeRouter: Router = v2Router();

v2MeRouter.get("/", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetMe(req, res);
}));

v2MeRouter.get("/apikey", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetKeyInfo(req, res);
}));

v2MeRouter.get("/client", expressAsyncHandler(async (req: MineSkinV2Request, res) => {
    await v2GetClientInfo(req, res);
}));