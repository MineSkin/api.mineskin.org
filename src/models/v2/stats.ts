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

    addQueries(helper: MGetHelper, date: Date, month: boolean = false, day: boolean = false, hour: boolean = false): Getter<{
        new: string | null,
        duplicate: string | null
    }> {
        const _new = this.addQuery(helper, date, month, day, hour, true);
        const _duplicate = this.addQuery(helper, date, month, day, hour, false);
        return {
            get() {
                return {
                    new: _new.get(),
                    duplicate: _duplicate.get()
                }
            }
        };
    }

    async _queryStats() {
        const date = new Date();
        const redis = container.get<IRedisProvider>(CoreTypes.RedisProvider);

        const timeHelper = new MGetHelper();

        const thisYear = this.addQueries(timeHelper, date);
        const thisMonth = this.addQueries(timeHelper, date, true);
        const thisDay = this.addQueries(timeHelper, date, true, true);
        const thisHour = this.addQueries(timeHelper, date, true, true, true);

        const lastDay = this.addQueries(timeHelper, new Date(date.getTime() - ONE_DAY_SECONDS * 1000), true, true);
        const lastHour = this.addQueries(timeHelper, new Date(date.getTime() - 60 * 60 * 1000), true, true, true);

        let timeResult = await timeHelper.execute(redis);

        const [statsKeys, accountsKeys] = await Promise.all([
            redis.client.keys('mineskin:generator:stats:*'),
            redis.client.keys('mineskin:accounts:usable:*'),
        ]);

        const statsHelper = new MGetHelper();
        const capacities: MGetGetter[] = [];
        const activities: MGetGetter[] = [];
        const usableAccounts: MGetGetter[] = [];
        for (const key of statsKeys) {
            if (key.endsWith('capacity')) {
                capacities.push(statsHelper.add(key));
            }
            if (key.endsWith('active')) {
                activities.push(statsHelper.add(key));
            }
        }
        for (const key of accountsKeys) {
            usableAccounts.push(statsHelper.add(key));
        }
        const statsResult = await statsHelper.execute(redis);

        const globalCapacity = capacities.map(g => g.get()).filter(g => !!g).reduce((acc, cur) => acc + parseInt(cur!), 0);
        const globalActive = activities.map(g => g.get()).filter(g => !!g).reduce((acc, cur) => acc + parseInt(cur!), 0);

        const globalUsableAccounts = usableAccounts.map(g => g.get()).filter(g => !!g).reduce((acc, cur) => acc + parseInt(cur!), 0);

        Log.l.debug(`redis stats query took ${ Date.now() - date.getTime() }ms`);

        return {
            raw: {
                timeResult,
                statsResult
            },
            generated: {
                time: {
                    hour: {
                        current: thisHour.get(),
                        last: lastHour.get()
                    },
                    day: {
                        current: thisDay.get(),
                        last: lastDay.get()
                    },
                    month: {
                        current: thisMonth.get()
                    },
                    year: {
                        current: thisYear.get()
                    }
                }
            },
            generator: {
                capacity: {
                    global: globalCapacity
                },
                active: {
                    global: globalActive
                }
            },
            accounts: {
                usable: {
                    global: globalUsableAccounts
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

class MGetGetter implements Getter<string | null> {

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

interface Getter<T> {
    get(): T;
}