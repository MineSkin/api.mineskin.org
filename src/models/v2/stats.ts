import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { V2ResponseBody } from "../../typings/v2/V2ResponseBody";
import { container } from "../../inversify.config";
import { IRedisProvider } from "@mineskin/core";
import { TYPES as CoreTypes } from "@mineskin/core/dist/ditypes";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { Log } from "../../Log";
import { ONE_DAY_SECONDS } from "../../util";


export async function v2GetStats(req: MineSkinV2Request, res: Response<V2ResponseBody>): Promise<V2MiscResponseBody> {
    const stats = await statsWrapper.getCachedV2Stats();
    return {
        success: true,
        stats: stats
    };
}

//TODO
const statsWrapper = new class {

    private cached: Promise<any> | null = null;
    private time: number = 0;

    async getCachedV2Stats(): Promise<any> {
        if (!this.cached || Date.now() - this.time > 1000 * 60) {
            this.cached = this._queryStats();
            this.time = Date.now();
        }
        return await this.cached;
    }

    makeKey(date: Date, month: boolean, day: boolean, hour: boolean, newDup: boolean) {
        let key = 'mineskin:generated:global:';
        key += date.getFullYear();
        if (month) {
            key += `:${ date.getMonth() + 1 }`;
            if (day) {
                key += `:${ date.getDate() }`;
                if (hour) {
                    key += `:${ date.getHours() }`;
                }
            }
        }
        key += newDup ? ':new' : ':duplicate';
        return key;
    }

    addQuery(helper: MGetHelper, date: Date, month: boolean = false, day: boolean = false, hour: boolean = false, newDup: boolean = false): MGetGetter {
        return helper.add(this.makeKey(date, month, day, hour, newDup));
    }

    addQueries(helper: MGetHelper, date: Date, month: boolean = false, day: boolean = false, hour: boolean = false): {
        new: MGetGetter,
        duplicate: MGetGetter
    } {
        return {
            new: this.addQuery(helper, date, month, day, hour, true),
            duplicate: this.addQuery(helper, date, month, day, hour, false)
        };
    }

    async _queryStats() {
        const date = new Date();
        const redis = container.get<IRedisProvider>(CoreTypes.RedisProvider);

        const helper = new MGetHelper();

        const thisYear = this.addQueries(helper, date);
        const thisMonth = this.addQueries(helper, date, true);
        const thisDay = this.addQueries(helper, date, true, true);
        const thisHour = this.addQueries(helper, date, true, true, true);

        const lastDay = this.addQueries(helper, new Date(date.getTime() - ONE_DAY_SECONDS * 1000), true, true);
        const lastHour = this.addQueries(helper, new Date(date.getTime() - 60 * 60 * 1000), true, true, true);

        let result = await helper.execute(redis);

        Log.l.debug(`redis stats query took ${ Date.now() - date.getTime() }ms`);

        return {
            raw: {
                result
            },
            generated: {
                time: {
                    hour: {
                        current: thisHour,
                        last: lastHour
                    },
                    day: {
                        current: thisDay,
                        last: lastDay
                    },
                    month: {
                        current: thisMonth
                    },
                    year: {
                        current: thisYear
                    }
                }
            }
        };
    }

}();

class MGetHelper {

    keys: string[] = [];
    values: (string | null)[] = [];

    constructor() {
    }

    add(key: string): MGetGetter {
        this.keys.push(key);
        return new MGetGetter(this, key);
    }

    async execute(redis: IRedisProvider) {
        this.values = await redis.client.mGet(this.keys);
        return this.values;
    }

}

class MGetGetter {

    private readonly helper: MGetHelper;
    private readonly key: string;

    constructor(helper: MGetHelper, key: string) {
        this.helper = helper;
        this.key = key;
    }

    get() {
        return this.helper.values[this.helper.keys.indexOf(this.key)];
    }

    toString() {
        return this.get() || '0';
    }

}