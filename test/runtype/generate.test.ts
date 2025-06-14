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

        test('should allow valid base64 url body', () => {
            let checked = GenerateReqUrl.parse({
                name: 'test name',
                visibility: 'public',
                variant: 'slim',
                url: 'data:image/png;base64,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'
            });
        });
        test('should disallow invalid base64 url body', () => {
             const t = () => {
                 let checked = GenerateReqUrl.parse({
                     name: 'test name',
                     visibility: 'public',
                     variant: 'slim',
                     url: 'data:image/jpeg;base64,gg=='
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
