import { SkinModel } from "@mineskin/database";
import { SkinVariant, SkinVisibility } from "@mineskin/types";
import { Maybe } from "./index";

export function validateModel(model?: string): SkinModel {
    if (!model || model.length < 3) {
        return SkinModel.UNKNOWN;
    }
    model = model.toLowerCase();

    if (model === "classic" || model === "default" || model === "steve") {
        return SkinModel.CLASSIC;
    }
    if (model === "slim" || model === "alex") {
        return SkinModel.SLIM;
    }

    return SkinModel.UNKNOWN;
}

export function validateVariant(variant?: string): SkinVariant {
    if (!variant || variant.length < 3) {
        return SkinVariant.UNKNOWN;
    }
    variant = variant.toLowerCase();

    if (variant === "classic" || variant === "default" || variant === "steve") {
        return SkinVariant.CLASSIC;
    }
    if (variant === "slim" || variant === "alex") {
        return SkinVariant.SLIM;
    }

    return SkinVariant.UNKNOWN;
}

export function validateVisibility(visibility?: number): SkinVisibility {
    return visibility == 1 ? SkinVisibility.UNLISTED : SkinVisibility.PUBLIC;
}

export function validateName(name?: string): Maybe<string> {
    if (!name) {
        return undefined;
    }
    name = `${ name }`.substr(0, 24).trim();
    if (name.length === 0) return undefined;
    return name;
}