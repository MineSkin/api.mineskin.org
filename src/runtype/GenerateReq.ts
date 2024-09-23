import { Intersect, Literal, Record, Static, String, Union } from "runtypes";
import { SkinVariant, SkinVisibility2 } from "@mineskin/types";

export const GenerateReqOptions = Record({
    name: String.withConstraint(s => s.length <= 20).optional(),
    visibility: Union(
        Literal(SkinVisibility2.PUBLIC),
        Literal(SkinVisibility2.UNLISTED),
        Literal(SkinVisibility2.PRIVATE)
    ).Or(Literal(SkinVisibility2.PUBLIC)),
    variant: Union(
        Literal(SkinVariant.CLASSIC),
        Literal(SkinVariant.SLIM)
    ).Or(Literal(SkinVariant.CLASSIC))
});

export const GenerateReqUrl = Intersect(
    GenerateReqOptions,
    Record({
        url: String.withConstraint(s => s.length > 0 && s.length < 256).withConstraint(s => s.startsWith("http://") || s.startsWith("https://"))
    })
);

export const GenerateReqUser = Intersect(
    GenerateReqOptions,
    Record({
        user: String.withConstraint(s => s.length === 36 || s.length === 32)
    })
)

export const GenerateReq = Union(
    GenerateReqOptions,
    GenerateReqUrl,
    GenerateReqUser
);

export type GenerateReqOptions = Static<typeof GenerateReqOptions>;
export type GenerateReqUrl = Static<typeof GenerateReqUrl>;
export type GenerateReqUser = Static<typeof GenerateReqUser>;
export type GenerateReq = Static<typeof GenerateReq>;