import { GenerateRequest } from "../typings";
import { GenerateV2Request } from "../routes/v2/types";
import { SkinVisibility, SkinVisibility2 } from "@mineskin/types";
import { validateName, validateVariant, validateVisibility } from "./validate";

export function rewriteV2Options(req: GenerateRequest | GenerateV2Request) {
    const variant = validateVariant(req.body["variant"] || req.query["variant"]);
    const oldVisibility = validateVisibility(req.body["visibility"] || req.query["visibility"]);
    const visibility = oldVisibility === SkinVisibility.PRIVATE ? SkinVisibility2.PRIVATE
        : oldVisibility === SkinVisibility.UNLISTED ? SkinVisibility2.UNLISTED
            : SkinVisibility2.PUBLIC;
    let name = validateName(req.body["name"] || req.query["name"]);
    name = name ? name.replace(/[^a-zA-Z0-9_.\- ]/g, "") : name;

    req.body["variant"] = variant;
    req.body["visibility"] = visibility;
    req.body["name"] = name;
}