import { SkinModel, SkinVariant, SkinVisibility } from "./ISkinDocument";
import { Bread } from "./Bread";

export interface GenerateOptions extends Bread {
    model: SkinModel;
    variant: SkinVariant;
    name: string;
    visibility: SkinVisibility;
}
