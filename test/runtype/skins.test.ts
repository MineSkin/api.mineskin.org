// import '@types/jest';
import { ValidationError } from "runtypes";
import { ListReqQuery } from "../../src/runtype/ListReq";


describe('skins runtype', () => {

    describe('list', () => {
        test('should allow valid params', () => {
            let checked = ListReqQuery.check({
                size: 32,
                after: 'bcd2033c63ec4bf88aca680b22461340',
                filter: 'test'
            });
        });
        test('should disallow invalid size', () => {
            const t = () => {
                let checked = ListReqQuery.check({
                    size: 512,
                    after: 'bcd2033c63ec4bf88aca680b22461340',
                    filter: 'test'
                });
            }
            expect(t).toThrow(ValidationError);
        });
        test('should disallow invalid after', () => {
            const t = () => {
                let checked = ListReqQuery.check({
                    size: 16,
                    after: 'notauuid',
                    filter: 'test'
                });
            }
            expect(t).toThrow(ValidationError);
        });
        test('should disallow longer filter', () => {
            const t = () => {
                let checked = ListReqQuery.check({
                    size: 16,
                    filter: 'test'.repeat(10)
                });
            }
            expect(t).toThrow(ValidationError);
        });
        test('should disallow invalid filter characters' , () => {
            const t = () => {
                let checked = ListReqQuery.check({
                    size: 16,
                    filter: 'test$'
                });
            }
            expect(t).toThrow(ValidationError);
        });
    })

});
