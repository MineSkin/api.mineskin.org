import { URL } from "url";
import * as Sentry from "@sentry/node";
import { AxiosError, AxiosResponse } from "axios";
import { Breadcrumb, Maybe } from "@mineskin/types";
import { Requests } from "../Requests";
import { Log } from "../../Log";
import { MAX_IMAGE_SIZE } from "@mineskin/generator";

const URL_REWRITES = new Map<RegExp, string>([
    [/https?:\/\/imgur\.com\/(.+)/, 'https://i.imgur.com/$1.png'],
    [/https?:\/\/.+namemc\.com\/skin\/(.+)/, 'https://namemc.com/texture/$1.png'],
    [/https?:\/\/.+minecraftskins\.com\/skin\/(\d+)\/.+/, 'https://www.minecraftskins.com/skin/download/$1'],
    [/https?:\/\/minecraft\.novaskin\.me\/skin\/(\d+)\/.+/, 'https://minecraft.novaskin.me/skin/$1/download'],
    [/https?:\/\/minesk(\.in|in\.org)\/([0-9a-zA-Z]+)/, 'https://api.mineskin.org/v2/skins/$2/texture']
]);

const URL_FOLLOW_WHITELIST = [
    "novask.in",
    "imgur.com",
    "i.imgur.com",
    "mineskin.org",
    "minesk.in",
    "api.mineskin.org"
];
const MAX_FOLLOW_REDIRECTS = 5;

export class UrlHandler {

    public static rewriteUrl(urlStr: string, breadcrumb: Breadcrumb): string {
        for (let [pattern, replacement] of URL_REWRITES.entries()) {
            if (pattern.test(urlStr)) {
                const str = urlStr.replace(pattern, replacement);
                Log.l.debug(`${ breadcrumb } Rewrite ${ urlStr } -> ${ str }`);
                return str;
            }
        }
        return urlStr;
    }

    public static async followUrl(urlStr: string, breadcrumb?: string): Promise<string | Maybe<AxiosResponse>> {
        if (!urlStr) return "no url";

        return await Sentry.startSpan({
            op: "generate_followUrl",
            name: "followUrl"
        }, async span => {
            try {
                const url = new URL(urlStr);
                if (!url.host || !url.pathname) {
                    return "invalid host or path";
                }
                if (!url.protocol || (url.protocol !== "http:" && url.protocol !== "https:")) {
                    return "invalid protocol";
                }
                const follow = URL_FOLLOW_WHITELIST.includes(url.host!);
                return await Requests.genericRequest({
                    method: "HEAD",
                    url: url.href,
                    maxRedirects: follow ? MAX_FOLLOW_REDIRECTS : 0,
                    timeout: 1000,
                    headers: {
                        "User-Agent": "MineSkin"
                    },
                    maxBodyLength: MAX_IMAGE_SIZE,
                    maxContentLength: MAX_IMAGE_SIZE
                }, breadcrumb).then(res => {
                    return res;
                });
            } catch (e) {
                Log.l.error(e);
                Sentry.captureException(e, {
                    extra: {
                        url: urlStr,
                        breadcrumb: breadcrumb
                    }
                });
                if (e?.message?.includes("timeout")) {
                    return "timeout";
                }
                if (e instanceof AxiosError) {
                    return e.message;
                }
            }
            return "request failed";
        })
    }

    public static getUrlFromResponse(response: AxiosResponse, originalUrl: string): string {
        return response.request.res.responseUrl || originalUrl; // the axios one may be null if the request was never redirected
    }

    public static getSizeFromResponse(response: AxiosResponse): number {
        return response.headers["content-length"];
    }

    public static getContentTypeFromResponse(response: AxiosResponse): string {
        return response.headers["content-type"];
    }

}
