import { V2ResponseBody } from "./V2ResponseBody";
import { SkinInfo2 } from "@mineskin/types";

export interface V2SkinListResponseBody extends V2ResponseBody {
    skins: ListedSkin[]; //TODO: partial
}

export type ListedSkin = Pick<SkinInfo2,'uuid'|'name'> & {texture?: string};