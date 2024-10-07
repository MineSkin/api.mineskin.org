import { Router } from "express";
import { v2ErrorHandler, v2GenerateAndWait } from "../../models/v2/generate";
import { v2Router } from "./router";

export const v2GenerateRouter: Router = v2Router();

v2GenerateRouter.post("/", v2GenerateAndWait);

v2GenerateRouter.use("/", v2ErrorHandler);