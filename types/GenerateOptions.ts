import { SkinModel, SkinVisibility } from "./ISkinDocument";

export interface GenerateOptions {
    model?: SkinModel;
    name?: string;
    visibility?: SkinVisibility;
}
