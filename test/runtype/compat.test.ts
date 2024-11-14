// import '@types/jest';
import { GenerateRequest } from "../../src/typings";
import { GenerateV2Request } from "../../src/routes/v2/types";
import { rewriteV2Options } from "../../src/util/compat";
import { SkinVisibility2 } from "@mineskin/types";


describe('compat', () => {

    describe('rewrite', () => {
        test('should rewrite v2 options', () => {
            let req = {
                body: {
                    name: 'way too long name which should get shortened',
                    visibility: 1,
                    variant: 'steve'
                }
            } as unknown as GenerateRequest | GenerateV2Request;
            rewriteV2Options(req);
            expect(req.body.name).toBe('way too long name which');
            expect(req.body.visibility).toBe(SkinVisibility2.UNLISTED);
            expect(req.body.variant).toBe('classic');
        });
    });


});
