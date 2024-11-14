// import '@types/jest';
import { GenerateReqUrl, GenerateReqUser } from "../../src/validation/generate";
import { ZodError } from "zod";


describe('generate runtype', () => {

    describe('generic', () => {
        test('should disallow too long name', () => {
            const t = () => {
                let checked = GenerateReqUrl.parse({
                    name: 'this is way too long to be valid',
                    visibility: 'public',
                    variant: 'classic',
                    url: 'https://example.com'
                });
            }
            expect(t).toThrow(ZodError);
        });
        test('should allow valid name', () => {
            const t = () => {
                let checked = GenerateReqUrl.parse({
                    name: 'some name',
                    visibility: 'public',
                    variant: 'classic',
                    url: 'https://example.com'
                });
            }
        });
        test('should allow empty name', () => {
            const t = () => {
                let checked = GenerateReqUrl.parse({
                    name: '',
                    visibility: 'public',
                    variant: 'classic',
                    url: 'https://example.com'
                });
            }
        });
        test('should disallow invalid name characters', () => {
            const t = () => {
                let checked = GenerateReqUrl.parse({
                    name: 'te%st/\)test',
                    visibility: 'public',
                    variant: 'classic',
                    url: 'https://example.com'
                });
            }
            expect(t).toThrow(ZodError);
        });
        test('should disallow invalid visibility', () => {
            const t = () => {
                let checked = GenerateReqUrl.parse({
                    name: 'test name',
                    visibility: 'idk',
                    variant: 'slim',
                    url: 'https://example.com'
                });
            }
            expect(t).toThrow(ZodError);
        });
        test('should disallow invalid variant', () => {
            const t = () => {
                let checked = GenerateReqUrl.parse({
                    name: 'test name',
                    visibility: 'public',
                    variant: 'idk',
                    url: 'https://example.com'
                });
            }
            expect(t).toThrow(ZodError);
        });
        test('should allow missing options', () => {
            const t = () => {
                let checked = GenerateReqUrl.parse({
                    url: 'https://example.com'
                });
            }
        });
    })

    describe('url', () => {
        test('should allow valid url body', () => {
            let checked = GenerateReqUrl.parse({
                name: 'test name',
                visibility: 'public',
                variant: 'slim',
                url: 'https://example.com'
            });
        });
        test('should disallow invalid url', () => {
            const t = () => {
                let checked = GenerateReqUrl.parse({
                    name: 'test name',
                    visibility: 'public',
                    variant: 'slim',
                    url: 'notaurl'
                });
            }
            expect(t).toThrow(ZodError);
        });
        test('should disallow long url', () => {
            const t = () => {
                let checked = GenerateReqUrl.parse({
                    name: 'test name',
                    visibility: 'public',
                    variant: 'slim',
                    url: 'https://example.com/' + ('longurl'.repeat(100))
                });
            }
            expect(t).toThrow(ZodError);
        });
    });

    describe('user', () => {
        test('should allow valid user body', () => {
            let checked = GenerateReqUser.parse({
                name: 'test name',
                visibility: 'public',
                variant: 'slim',
                user: 'bcd2033c63ec4bf88aca680b22461340'
            });
        });
        test('should disallow invalid uuid', () => {
            const t = () => {
                let checked = GenerateReqUser.parse({
                    name: 'test name',
                    visibility: 'public',
                    variant: 'slim',
                    user: 'notauuid'
                });
            }
            expect(t).toThrow(ZodError);
        });
        test('should disallow invalid uuid characters', () => {
            const t = () => {
                let checked = GenerateReqUser.parse({
                    name: 'test name',
                    visibility: 'public',
                    variant: 'slim',
                    user: '&$_.'
                });
            }
            expect(t).toThrow(ZodError);
        });
    });


});
