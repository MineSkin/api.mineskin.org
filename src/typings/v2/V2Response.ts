import { CodeAndMessage } from "./CodeAndMessage";

export interface V2Response {
    success: boolean;
    errors?: CodeAndMessage[];
    warnings?: CodeAndMessage[];
}