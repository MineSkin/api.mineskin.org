import { Response, Router } from "express";
import { v2Router } from "./router";
import expressAsyncHandler from "express-async-handler";
import { MineSkinV2Request } from "./types";
import { ISkin2Document, Skin2 } from "@mineskin/database";
import { RootFilterQuery } from "mongoose";
import { SkinVisibility2 } from "@mineskin/types";

const router: Router = v2Router();

router.get("/web-skins.xml", expressAsyncHandler(async (req: MineSkinV2Request, res: Response) => {
    res.header('Cache-Control', 'public, max-age=3600');
    res.header('Content-Type', 'application/xml');

     const query: RootFilterQuery<ISkin2Document> = {
        'meta.visibility': SkinVisibility2.PUBLIC
    };
     const skins = await Skin2.find(query)
        .limit(1024)
        .select('uuid meta updatedAt')
        .sort({_id: -1})
        .exec();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (let skin of skins) {
        xml += '  <url>\n';
        xml += `    <loc>https://mineskin.org/skins/${ skin.uuid }</loc>\n`;
        xml += `    <lastmod>${ skin.updatedAt.toISOString() }</lastmod>\n`;
        xml += '  </url>\n';
    }
    xml += '</urlset>\n';

    res.send(xml);
}));

export const v2SitemapsRouter: Router = router;