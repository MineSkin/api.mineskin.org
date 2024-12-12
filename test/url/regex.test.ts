import { UrlHandler } from "../../src/generator/v2/UrlHandler";

describe('UrlHandler regex', () => {
    test('mineskin direct long', () => {
        expect(UrlHandler.isMineSkinUrl('https://minesk.in/6fe322781ce44fd38d24e6749423ca86')).toBe(true);
    });
    test('mineskin direct short', () => {
        expect(UrlHandler.isMineSkinUrl('https://minesk.in/b2515142')).toBe(true);
    });
    test('mineskin url', () => {
        expect(UrlHandler.isMineSkinUrl('https://mineskin.org/6c1e4b60341147709ce4d0c7a0615187')).toBe(true);
    });

     test('texture', () => {
        expect(UrlHandler.isMinecraftTextureUrl('https://textures.minecraft.net/texture/cc1b22d0226047402dba03e9616cb47bf909d9c45d2741b0dddba2e0a7b343cc')).toBe(true);
    });
});
