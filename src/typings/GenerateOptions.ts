import { SkinModel, SkinVariant, SkinVisibility } from "./db/ISkinDocument";
import { Bread } from "./Bread";

export interface GenerateOptions extends Bread {
    /**@deprecated**/
    model: SkinModel;
    variant: SkinVariant;
    name?: string;
    visibility: SkinVisibility;
}
