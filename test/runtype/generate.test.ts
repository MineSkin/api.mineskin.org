// import '@types/jest';
import { GenerateReqUrl, GenerateReqUser } from "../../src/runtype/GenerateReq";
import { ValidationError } from "runtypes";


describe('generate runtype', () => {

    describe('generic', () => {
        test('should disallow too long name', () => {
            const t = () => {
                let checked = GenerateReqUrl.check({
                    name: 'this is way too long to be valid',
                    visibility: 'public',
                    variant: 'classic',
                    url: 'https://example.com'
                });
            }
            expect(t).toThrow(ValidationError);
        });
        test('should disallow invalid name characters', () => {
            const t = () => {
                let checked = GenerateReqUrl.check({
                    name: 'te%st/\)test',
                    visibility: 'public',
                    variant: 'classic',
                    url: 'https://example.com'
                });
            }
            expect(t).toThrow(ValidationError);
        });
        test('should disallow invalid visibility', () => {
            const t = () => {
                let checked = GenerateReqUrl.check({
                    name: 'test name',
                    visibility: 'idk',
                    variant: 'slim',
                    url: 'https://example.com'
                });
            }
            expect(t).toThrow(ValidationError);
        });
        test('should disallow invalid variant', () => {
            const t = () => {
                let checked = GenerateReqUrl.check({
                    name: 'test name',
                    visibility: 'public',
                    variant: 'idk',
                    url: 'https://example.com'
                });
            }
            expect(t).toThrow(ValidationError);
        });
    })

    describe('url', () => {
        test('should allow valid url body', () => {
            let checked = GenerateReqUrl.check({
                name: 'test name',
                visibility: 'public',
                variant: 'slim',
                url: 'https://example.com'
            });
        });
        test('should disallow invalid url', () => {
            const t = () => {
                let checked = GenerateReqUrl.check({
                    name: 'test name',
                    visibility: 'public',
                    variant: 'slim',
                    url: 'notaurl'
                });
            }
            expect(t).toThrow(ValidationError);
        });
        test('should disallow long url', () => {
            const t = () => {
                let checked = GenerateReqUrl.check({
                    name: 'test name',
                    visibility: 'public',
                    variant: 'slim',
                    url: 'https://example.com/' + ('longurl'.repeat(100))
                });
            }
            expect(t).toThrow(ValidationError);
        });
    });

    describe('user', () => {
        test('should allow valid user body', () => {
            let checked = GenerateReqUser.check({
                name: 'test name',
                visibility: 'public',
                variant: 'slim',
                uuid: 'bcd2033c63ec4bf88aca680b22461340'
            });
        });
        test('should disallow invalid uuid', () => {
            const t = () => {
                let checked = GenerateReqUser.check({
                    name: 'test name',
                    visibility: 'public',
                    variant: 'slim',
                    uuid: 'notauuid'
                });
            }
            expect(t).toThrow(ValidationError);
        });
        test('should disallow invalid uuid characters', () => {
            const t = () => {
                let checked = GenerateReqUser.check({
                    name: 'test name',
                    visibility: 'public',
                    variant: 'slim',
                    uuid: '&$_.'
                });
            }
            expect(t).toThrow(ValidationError);
        });
    });


});
