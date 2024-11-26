// import '@types/jest';
import { ShortId, UUID } from "../../src/validation/misc";


describe('misc', () => {

    describe('uuid', () => {
        test('should parse long uuid', () => {
            UUID.parse('68e51543-64cf-42cc-8850-62a04fcfe10c');
        });
        test('should parse short uuid', () => {
            UUID.parse('68e5154364cf42cc885062a04fcfe10c');
        });
    });

    describe('short id', () => {
        test('should parse short id', () => {
            ShortId.parse('68e51543');
        });
    })


});
