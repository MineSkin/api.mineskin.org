export { IAccountDocument } from "./IAccountDocument";
export { ISkinDocument } from "./ISkinDocument";
export { ITrafficDocument } from "./ITrafficDocument";
export { IStatDocument } from "./IStatDocument";

// https://stackoverflow.com/a/60323233/6257838
export class MineSkinError extends Error {
    constructor(public code: string, public msg?: string, public httpCode?: number) {
        super(msg ? `[${ code }] ${ msg }` : code);
        Object.setPrototypeOf(this, MineSkinError.prototype);
    }

    get name(): string {
        return 'MineSkinError';
    }
}

