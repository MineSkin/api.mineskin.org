import { RateLimitInfo } from "@mineskin/types";
import { V2ResponseBody } from "./V2ResponseBody";

export interface V2GenerateResponseBody extends V2ResponseBody {
    rateLimit?: RateLimitInfo;
}