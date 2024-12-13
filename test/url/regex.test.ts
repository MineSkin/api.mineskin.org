import { UrlChecks } from "../../src/generator/v2/UrlChecks";

describe('UrlHandler regex', () => {
    test('mineskin direct long', () => {
        expect(UrlChecks.isMineSkinUrl('https://minesk.in/6fe322781ce44fd38d24e6749423ca86')).toBe(true);
    });
    test('mineskin direct short', () => {
        expect(UrlChecks.isMineSkinUrl('https://minesk.in/b2515142')).toBe(true);
    });
    test('mineskin url', () => {
        expect(UrlChecks.isMineSkinUrl('https://mineskin.org/6c1e4b60341147709ce4d0c7a0615187')).toBe(true);
    });

     test('texture', () => {
        expect(UrlChecks.isMinecraftTextureUrl('https://textures.minecraft.net/texture/cc1b22d0226047402dba03e9616cb47bf909d9c45d2741b0dddba2e0a7b343cc')).toBe(true);
    });
});
