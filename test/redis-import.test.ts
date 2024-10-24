// import '@types/jest';
import "reflect-metadata"

import { setIfLessEX } from "@mineskin/billing";

describe('redis import', () => {
    test('setIfLessEX should be defined', () => {
        expect(setIfLessEX).toBeDefined();
        expect(setIfLessEX.script).toBeDefined();
    });
});
