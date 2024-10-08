import { V2ResponseBody } from "./V2ResponseBody";
import { SkinInfo2 } from "@mineskin/types";

export interface V2SkinListResponseBody extends V2ResponseBody {
    skins: ListedSkin[];
    pagination: {
        next?: {
            after: string;
            href: string;
        }
    }
}

export type ListedSkin = Pick<SkinInfo2,'uuid'|'name'> & {texture?: string};