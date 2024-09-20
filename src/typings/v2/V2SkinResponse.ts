import { SkinInfo2 } from "@mineskin/types";
import { V2GenerateResponse } from "./V2GenerateResponse";

export interface V2SkinResponse extends V2GenerateResponse {
    skin: SkinInfo2;
}