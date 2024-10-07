import { SkinInfo2 } from "@mineskin/types";
import { V2GenerateResponseBody } from "./V2GenerateResponseBody";

export interface V2JobResponse extends V2GenerateResponseBody {
    job: {
        id: string;
        status: string;
    };
    skin?: SkinInfo2;
}