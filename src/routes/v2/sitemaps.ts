import { Response, Router } from "express";
import { v2Router } from "./router";
import expressAsyncHandler from "express-async-handler";
import { MineSkinV2Request } from "./types";
import { ISkin2Document, Skin2 } from "@mineskin/database";
import { RootFilterQuery } from "mongoose";
import { SkinVisibility2 } from "@mineskin/types";
import { container } from "../../inversify.config";
import { IRedisProvider } from "@mineskin/core";
import { TYPES as CoreTypes } from "@mineskin/core/dist/ditypes";

const router: Router = v2Router();

router.get("/web-skins.xml", expressAsyncHandler(async (req: MineSkinV2Request, res: Response) => {
    res.header('Cache-Control', 'public, max-age=3600');
    res.header('Content-Type', 'application/xml');

    const query: RootFilterQuery<ISkin2Document> = {
        'meta.visibility': SkinVisibility2.PUBLIC
    };
    const skins = await Skin2.find(query)
        .limit(2048)
        .select('uuid meta updatedAt')
        .sort({_id: -1})
        .exec();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (let skin of skins) {
        xml += '  <url>\n';
        xml += `    <loc>https://mineskin.org/skins/${ skin.uuid }</loc>\n`;
        xml += `    <lastmod>${ skin.updatedAt.toISOString() }</lastmod>\n`;
        xml += `    <priority>0.4</priority>\n`;
        xml += '  </url>\n';
    }
    xml += '</urlset>\n';

    res.send(xml);
}));

router.get("/web-skins-popular-24h.xml", expressAsyncHandler(async (req: MineSkinV2Request, res: Response) => {
    res.header('Cache-Control', 'public, max-age=3600');
    res.header('Content-Type', 'application/xml');

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    // extra check to not include recently migrated skins
    // TODO: remove
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const query: RootFilterQuery<ISkin2Document> = {
        'meta.visibility': SkinVisibility2.PUBLIC,
        'interaction.views': {$gt: 5},
        updatedAt: {$gte: oneDayAgo},
        createdAt: {$gte: oneWeekAgo}
    };
    const skins = await Skin2.find(query)
        .limit(2048)
        .select('uuid meta updatedAt')
        .sort({_id: -1, 'interaction.views': -1})
        .exec();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (let skin of skins) {
        xml += '  <url>\n';
        xml += `    <loc>https://mineskin.org/skins/${ skin.uuid }</loc>\n`;
        xml += `    <lastmod>${ skin.updatedAt.toISOString() }</lastmod>\n`;
        xml += `    <changefreq>daily</changefreq>\n`;
        xml += `    <priority>0.6</priority>\n`;
        xml += '  </url>\n';
    }
    xml += '</urlset>\n';

    res.send(xml);
}));

router.get("/web-skins-popular-30d.xml", expressAsyncHandler(async (req: MineSkinV2Request, res: Response) => {
    res.header('Cache-Control', 'public, max-age=3600');
    res.header('Content-Type', 'application/xml');

    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);

    const query: RootFilterQuery<ISkin2Document> = {
        'meta.visibility': SkinVisibility2.PUBLIC,
        'interaction.views': {$gt: 5},
        updatedAt: {$gte: oneMonthAgo},
        createdAt: {$gte: oneMonthAgo}
    };
    const skins = await Skin2.find(query)
        .limit(2048)
        .select('uuid meta updatedAt')
        .sort({_id: -1, 'interaction.views': -1})
        .exec();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (let skin of skins) {
        xml += '  <url>\n';
        xml += `    <loc>https://mineskin.org/skins/${ skin.uuid }</loc>\n`;
        xml += `    <lastmod>${ skin.updatedAt.toISOString() }</lastmod>\n`;
        xml += `    <changefreq>weekly</changefreq>\n`;
        xml += `    <priority>0.6</priority>\n`;
        xml += '  </url>\n';
    }
    xml += '</urlset>\n';

    res.send(xml);
}));

router.get("/web-search-common.xml", expressAsyncHandler(async (req: MineSkinV2Request, res: Response) => {
    res.header('Cache-Control', 'public, max-age=3600');
    res.header('Content-Type', 'application/xml');

    const redis = container.get<IRedisProvider>(CoreTypes.RedisProvider);
    const terms = await redis.client.zRange('mineskin:search_terms', 3, 999, {
        BY: 'SCORE'
    });

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (let term of terms) {
        term = encodeURIComponent(term.trim());
        xml += '  <url>\n';
        xml += `    <loc>https://mineskin.org/skins/?search=${ term }</loc>\n`;
        xml += `    <lastmod>${ new Date().toISOString() }</lastmod>\n`;
        xml += `    <changefreq>daily</changefreq>\n`;
        xml += `    <priority>0.7</priority>\n`;
        xml += '  </url>\n';
    }
    xml += '</urlset>\n';

    res.send(xml);
}));

export const v2SitemapsRouter: Router = router;