import { CodeAndMessage } from "./CodeAndMessage";

export interface V2Response {
    success: boolean;
    messages?: CodeAndMessage[];
    errors?: CodeAndMessage[];
    warnings?: CodeAndMessage[];
}