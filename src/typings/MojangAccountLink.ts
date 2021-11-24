import { Maybe } from "../util";

export interface MojangAccountLink {
    state: string;
    email: Maybe<string>;
    gamePass: boolean;
}
