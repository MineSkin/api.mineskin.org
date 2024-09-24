import { SkinInfo2 } from "@mineskin/types";
import { V2GenerateResponseBody } from "./V2GenerateResponseBody";

export interface V2SkinResponse extends V2GenerateResponseBody {
    skin: SkinInfo2;
}