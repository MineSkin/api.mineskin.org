import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { V2ResponseBody } from "../../typings/v2/V2ResponseBody";
import { container } from "../../inversify.config";
import { IRedisProvider } from "@mineskin/core";
import { TYPES as CoreTypes } from "@mineskin/core/dist/ditypes";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";
import { Log } from "../../Log";
import { ONE_DAY_SECONDS } from "../../util";
import * as Sentry from "@sentry/node";
import { MineSkinMetrics } from "../../util/metrics";

export async function v2GetStats(req: MineSkinV2Request, res: Response<V2ResponseBody>): Promise<V2MiscResponseBody> {
    const stats = await statsWrapper.getCachedV2Stats();
    return {
        success: true,
        stats: stats
    };
}

export async function getCachedV2Stats(load: boolean = true): Promise<any | null> {
    return await statsWrapper.getCachedV2Stats(load);
}

//TODO
const statsWrapper = new class {

    private cached: Promise<any> | null = null;
    private time: number = 0;

    async getCachedV2Stats(load: boolean = true): Promise<any> {
        if (!this.cached || Date.now() - this.time > 1000 * 20) {
            if (!load) {
                return null;
            }
            try {
                this.cached = this._queryStats();
            } catch (e) {
                Sentry.captureException(e);
                return;
            }
            this.time = Date.now();
        }
        return {
            ...await this.cached,
            timestamp: this.time
        };
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
        new: number,
        duplicate: number
    }> {
        const _new = this.addQuery(helper, date, month, day, hour, true);
        const _duplicate = this.addQuery(helper, date, month, day, hour, false);
        return {
            get() {
                return {
                    new: Number(_new.get()),
                    duplicate: Number(_duplicate.get())
                }
            }
        };
    }

    async _queryStats() {
        let date = new Date();
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

        const totalNew = statsHelper.add('mineskin:generated:total:new');
        const totalDuplicate = statsHelper.add('mineskin:generated:total:duplicate');

        const durationMean = statsHelper.add('mineskin:generator:stats:duration:mean');
        const pendingDurationMean = statsHelper.add('mineskin:generator:stats:pending_duration:mean');

        const statsResult = await statsHelper.execute(redis);

        const globalCapacity = capacities.map(g => g.get()).filter(g => !!g).reduce((acc, cur) => acc + Number(cur), 0);
        const globalActive = activities.map(g => g.get()).filter(g => !!g).reduce((acc, cur) => acc + Number(cur), 0);

        const globalUsableAccounts = usableAccounts.map(g => g.get()).filter(g => !!g).reduce((acc, cur) => acc + Number(cur), 0);

        Log.l.debug(`redis stats query took ${ Date.now() - date.getTime() }ms`);

        date = new Date();

        const metrics = container.get<MineSkinMetrics>(CoreTypes.MetricsProvider);
        const [success1h, fail1h, success1d, fail1d] = await metrics.getMetrics().influx.query<{ sum: number }>([
            `SELECT sum("count") FROM "generate_success" WHERE time > now() - 1h GROUP BY time(1h) fill(null)`,
            `SELECT sum("count") FROM "generate_fail" WHERE time > now() - 1h GROUP BY time(1h) fill(null)`,
            `SELECT sum("count") FROM "generate_success" WHERE time > now() - 1d GROUP BY time(1d) fill(null)`,
            `SELECT sum("count") FROM "generate_fail" WHERE time > now() - 1d GROUP BY time(1d) fill(null)`
        ], {
            database: 'mineskin',
            precision: 's'
        });
        let [upstreamErrors5m] = await metrics.getMetrics().influx.query<{ sum: number; tag: string; }>([
            `SELECT sum("count") FROM "one_month"."upstream_errors" WHERE time > now() - 10m GROUP BY time(10m), "tag"::tag fill(0)`
        ], {
            database: 'mineskin',
            precision: 's'
        });

        const total1h = success1h[0]?.sum + fail1h[0]?.sum || 0;
        const successRate1h = Math.round((success1h[0]?.sum / total1h * 100 || 0) * 10) / 10;

        const total1d = success1d[0]?.sum + fail1d[0]?.sum || 0;
        const successRate1d = Math.round((success1d[0]?.sum / total1d * 100 || 0) * 10) / 10;

        console.debug(JSON.stringify(upstreamErrors5m));
        if(!Array.isArray(upstreamErrors5m) && typeof upstreamErrors5m === 'object') {
            // @ts-ignore
            upstreamErrors5m = [upstreamErrors5m];
        }
        const upstreamErrorsByTag: Record<string, number> = {};
        try {
            for (let cur of upstreamErrors5m) {
                if (!cur.tag) {
                    continue;
                }
                if (!upstreamErrorsByTag[cur.tag]) {
                    upstreamErrorsByTag[cur.tag] = 0;
                }
                upstreamErrorsByTag[cur.tag] += cur.sum || 0;
            }
        } catch (e) {
            Log.l.error('Error processing upstream errors', e);
            Sentry.captureException(e);
        }

        Log.l.debug(`influx stats query took ${ Date.now() - date.getTime() }ms`);

        return {
            generated: {
                time: {
                    hour: {
                        current: thisHour.get(),
                        last: lastHour.get(),
                        successRate: successRate1h
                    },
                    day: {
                        current: thisDay.get(),
                        last: lastDay.get(),
                        successRate: successRate1d
                    },
                    month: {
                        current: thisMonth.get()
                    },
                    year: {
                        current: thisYear.get()
                    }
                },
                total: {
                    new: Number(totalNew.get()),
                    duplicate: Number(totalDuplicate.get())
                }
            },
            generator: {
                capacity: {
                    global: globalCapacity
                },
                active: {
                    global: globalActive
                },
                duration: {
                    generate: Math.round(Number(durationMean.get()) / 10) * 10,
                    pending: Math.round(Number(pendingDurationMean.get()) / 10) * 10
                }
            },
            accounts: {
                usable: {
                    global: globalUsableAccounts
                }
            },
            upstream: {
                errors: upstreamErrorsByTag
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
        if (this.keys.length === 0) {
            return [];
        }
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