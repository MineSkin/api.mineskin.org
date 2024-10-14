import { V2ResponseBody } from "./V2ResponseBody";
import { JobInfo } from "@mineskin/types";

export interface V2JobListResponse extends V2ResponseBody{
    jobs: JobInfo[];
}