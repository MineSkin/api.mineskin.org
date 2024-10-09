// import '@types/jest';
import { ListReqQuery } from "../../src/validation/skins";
import { ZodError } from "zod";


describe('skins runtype', () => {

    describe('list', () => {
        test('should allow valid params', () => {
            let checked = ListReqQuery.parse({
                size: 32,
                after: 'bcd2033c63ec4bf88aca680b22461340',
                filter: 'test'
            });
        });
        test('should disallow invalid size', () => {
            const t = () => {
                let checked = ListReqQuery.parse({
                    size: 512,
                    after: 'bcd2033c63ec4bf88aca680b22461340',
                    filter: 'test'
                });
            }
            expect(t).toThrow(ZodError);
        });
        test('should disallow invalid after', () => {
            const t = () => {
                let checked = ListReqQuery.parse({
                    size: 16,
                    after: 'notauuid',
                    filter: 'test'
                });
            }
            expect(t).toThrow(ZodError);
        });
        test('should disallow longer filter', () => {
            const t = () => {
                let checked = ListReqQuery.parse({
                    size: 16,
                    filter: 'test'.repeat(10)
                });
            }
            expect(t).toThrow(ZodError);
        });
        test('should disallow invalid filter characters' , () => {
            const t = () => {
                let checked = ListReqQuery.parse({
                    size: 16,
                    filter: 'test$'
                });
            }
            expect(t).toThrow(ZodError);
        });
    })

});
