import { MineSkinV2Request } from "../routes/v2/types";
import { NextFunction, Response } from "express";
import { v4 as randomUuid } from "uuid";
import { nextBreadColor } from "../typings/Bread";
import { Chalk } from "chalk";

export const breadcrumbMiddleware = (req: MineSkinV2Request, res: Response, next: NextFunction) => {
    applyBreadcrumb(req, res);
    next();
}

export const applyBreadcrumb = (req: MineSkinV2Request, res: Response) => {
    const id = randomUuid().substring(0, 8);
    const color = nextBreadColor();

    setBreadcrumb(req, res, id, color);

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

export const setBreadcrumb = (req: MineSkinV2Request, res: Response, breadcrumb: string, color?: Chalk) => {
    req.breadcrumb = breadcrumb;
    if (color) {
        req.breadcrumbColor = color;
        req.breadcrumbC = color(breadcrumb);
    }

    res.header("MineSkin-Breadcrumb", req.breadcrumb);
}