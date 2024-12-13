import { URL } from "url";

export const URL_REGEX = /https?:\/\/.+/i;
const BLOCKED_URL_HOSTS: RegExp[] = [
    /localhost/i,
    /127\.0\.0\.1/i,
    /0\.0\.0\.0/i,
    /::1/i,
    /192\.168\./i,
    /10\./i,
    /172\.(1[6-9]|2[0-9]|3[01])\./i
]

const MINESKIN_URL_REGEX = /https?:\/\/minesk(\.in|in\.org)\/([0-9a-zA-Z]+)/i;
const MINECRAFT_TEXTURE_REGEX = /https?:\/\/textures\.minecraft\.net\/texture\/([0-9a-z]+)/i;

export class UrlChecks {

    public static isBlockedHost(urlStr: string) {
        try {
            const url = new URL(urlStr);
            return BLOCKED_URL_HOSTS.some(host => host.test(url.host!));
        } catch (e) {
            return true;
        }
    }

    public static isMineSkinUrl(url: string): boolean {
        return MINESKIN_URL_REGEX.test(url);
    }

    public static isMinecraftTextureUrl(url: string): boolean {
        return MINECRAFT_TEXTURE_REGEX.test(url);
    }

}