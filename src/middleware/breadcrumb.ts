import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { v4 as randomUuid } from "uuid";
import { nextBreadColor } from "../typings/Bread";

export const breadcrumbMiddleware = (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    applyBreadcrumb(req, res);
    next();
}

export const applyBreadcrumb = (req: MineSkinV2Request, res: Response) => {
    const id = randomUuid().substring(0, 8);
    const color = nextBreadColor();
    req.breadcrumb = id;
    req.breadcrumbColor = color;
    req.breadcrumbC = color(id);

    res.header("X-MineSkin-Breadcrumb", req.breadcrumb);

    if (!req.warnings) {
        req.warnings = [];
    }
    if (!req.messages) {
        req.messages = [];
    }
    if (!req.links) {
        req.links = {};
    }
}