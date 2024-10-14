import { JobInfo, SkinInfo2 } from "@mineskin/types";
import { V2GenerateResponseBody } from "./V2GenerateResponseBody";

export interface V2JobResponse extends V2GenerateResponseBody {
    job: JobInfo;
    skin?: SkinInfo2;
}