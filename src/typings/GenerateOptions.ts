import { Bread } from "./Bread";
import { SkinVariant, SkinVisibility } from "@mineskin/types";
import { SkinModel } from "@mineskin/database";

export interface GenerateOptions extends Bread {
    /**@deprecated**/
    model: SkinModel;
    variant: SkinVariant;
    name?: string;
    visibility: SkinVisibility;
    checkOnly?: boolean;
}
