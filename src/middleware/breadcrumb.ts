import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { v4 as randomUuid } from "uuid";
import { nextBreadColor } from "../typings/Bread";

export const breadcrumbMiddleware = (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    const id = randomUuid().substring(0, 8);
    const color = nextBreadColor();
    req.breadcrumb = id;
    req.breadcrumbColor = color;
    req.breadcrumbC = color(id);

    res.header("X-MineSkin-Breadcrumb", req.breadcrumb);

    if (!req.warnings) {
        req.warnings = [];
    }

    next();
}