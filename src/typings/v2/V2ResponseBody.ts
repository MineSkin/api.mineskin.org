import { CodeAndMessage } from "./CodeAndMessage";

export interface V2ResponseBody {
    success?: boolean;
    messages?: CodeAndMessage[];
    errors?: CodeAndMessage[];
    warnings?: CodeAndMessage[];
    links?: {
        [key: string]: string;
    }
}