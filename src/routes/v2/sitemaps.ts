import { Response, Router } from "express";
import { v2Router } from "./router";
import { v2SkinList } from "../../models/v2/skins";
import expressAsyncHandler from "express-async-handler";
import { MineSkinV2Request } from "./types";

const router: Router = v2Router();

router.get("/web-skins.xml", expressAsyncHandler(async (req: MineSkinV2Request, res: Response) => {
    req.query.size = '128';
    const result = await v2SkinList(req, res);
    res.header('Cache-Control', 'public, max-age=3600');
    res.header('Content-Type', 'application/xml');

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (let skin of result.skins) {
        xml += '  <url>\n';
        xml += `    <loc>https://beta.mineskin.org/skins/${ skin.uuid }</loc>\n`;
        xml += '  </url>\n';
    }
    xml += '</urlset>\n';

    res.send(xml);
}));

export const v2SitemapsRouter: Router = router;