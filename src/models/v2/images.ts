import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { Sha256 } from "../../validation/misc";
import { Image } from "@mineskin/database";
import { MineSkinError } from "@mineskin/types";

export async function v2GetImage(req: MineSkinV2Request, res: Response): Promise<void> {
    const hash = Sha256.parse(req.params.hash);

    const image = await Image.findOne({hash}).exec();
    if (!image) {
        throw new MineSkinError("image_not_found", "Image not found", {httpCode: 404});
    }

    res.header("Content-Type", 'image/png');

    res.send(image.data);
}