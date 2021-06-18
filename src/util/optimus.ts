import { Maybe } from "./index";
import { MineSkinMetrics } from "./metrics";
import { getConfig } from "../typings/Configs";
import { Optimus } from "@inventivetalent/optimus-ts";

export class MineSkinOptimus {

    private static instance: Maybe<Optimus>;

    public static async get(): Promise<Optimus> {
        if (MineSkinOptimus.instance) {
            return MineSkinOptimus.instance;
        }
        const config = await getConfig();
        MineSkinOptimus.instance = new Optimus(config.optimus.prime, config.optimus.inverse, config.optimus.random);
        return MineSkinOptimus.instance;
    }

}
