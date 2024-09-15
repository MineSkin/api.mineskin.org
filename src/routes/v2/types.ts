import { Request } from "express";
import { Breadcrumb } from "@mineskin/types";

export type MineSkinV2Request = Request & {breadcrumb?: Breadcrumb};
export type GenerateV2Request = MineSkinV2Request;