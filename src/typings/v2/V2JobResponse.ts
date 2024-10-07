import { SkinInfo2, UUID } from "@mineskin/types";
import { V2GenerateResponseBody } from "./V2GenerateResponseBody";

export interface V2JobResponse extends V2GenerateResponseBody {
    job: {
        uuid: UUID;
        status: string;
    };
    skin?: SkinInfo2;
}