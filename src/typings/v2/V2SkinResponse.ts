import { V2Response } from "./V2Response";
import { SkinInfo2 } from "@mineskin/types";

export interface V2SkinResponse extends V2Response{
    skin: SkinInfo2;
}