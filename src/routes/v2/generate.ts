import { Response, Router } from "express";
import { v2ErrorHandler, v2GenerateAndWait } from "../../models/v2/generate";
import { v2Router } from "./router";
import { GenerateV2Request } from "./types";
import { V2GenerateResponseBody } from "../../typings/v2/V2GenerateResponseBody";
import expressAsyncHandler from "express-async-handler";

export const v2GenerateRouter: Router = v2Router();

v2GenerateRouter.post("/", expressAsyncHandler(async (req: GenerateV2Request, res: Response<V2GenerateResponseBody>)=>{
    const result = await v2GenerateAndWait(req, res);
    res.json(result);
}));

v2GenerateRouter.use("/", v2ErrorHandler);