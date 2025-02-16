import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { V2ResponseBody } from "../../typings/v2/V2ResponseBody";
import { Cape } from "@mineskin/database";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";

export async function listKnownCapes(req: MineSkinV2Request, res: Response<V2ResponseBody>): Promise<V2MiscResponseBody> {
    const capes = await Cape.find();
    return {
        success: true,
        capes: capes.map(cape => ({
            uuid: cape.uuid,
            alias: cape.alias,
            url: cape.url,
            supported: cape.supported
        }))
    }
}