import { RateLimitInfo } from "@mineskin/types";
import { V2Response } from "./V2Response";

export interface V2GenerateResponse extends V2Response {
    rateLimit?: RateLimitInfo;
}