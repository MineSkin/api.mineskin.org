import { SkinModel, SkinVariant, SkinVisibility } from "./ISkinDocument";

export interface GenerateOptions {
    model: SkinModel;
    variant: SkinVariant;
    name: string;
    visibility: SkinVisibility;
}
