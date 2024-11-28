import { MineSkinV2Request } from "../../routes/v2/types";
import { Response } from "express";
import { V2ResponseBody } from "../../typings/v2/V2ResponseBody";
import { container } from "../../inversify.config";
import { IRedisProvider } from "@mineskin/core";
import { TYPES as CoreTypes } from "@mineskin/core/dist/ditypes";
import { V2MiscResponseBody } from "../../typings/v2/V2MiscResponseBody";


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

    async getCachedV2Stats() {
        if (!this.cached || Date.now() - this.time > 1000 * 60) {
            this.cached = this._queryStats();
            this.time = Date.now();
        }
        return await this.cached;
    }

    async _queryStats() {
        const date = new Date();
        const redis = container.get<IRedisProvider>(CoreTypes.RedisProvider);

        const timeMGet = await redis.client.mGet([
            `mineskin:generated:global:${ date.getFullYear() }:new`,
            `mineskin:generated:global:${ date.getFullYear() }:duplicate`,
            `mineskin:generated:global:${ date.getFullYear() }:${ date.getMonth() + 1 }:new`,
            `mineskin:generated:global:${ date.getFullYear() }:${ date.getMonth() + 1 }:duplicate`,
            `mineskin:generated:global:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ date.getDate() }:new`,
            `mineskin:generated:global:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ date.getDate() }:duplicate`,
            `mineskin:generated:global:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ date.getDate() }:${ date.getHours() }:new`,
            `mineskin:generated:global:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ date.getDate() }:${ date.getHours() }:duplicate`
        ]);
        const [
            thisYearNew,
            thisYearDup,
            thisMonthNew,
            thisMonthDup,
            thisDayNew,
            thisDayDup,
            thisHourNew,
            thisHourDup
        ] = timeMGet;

        return {
            raw: {
                timeMGet
            },
            generated: {
                time: {
                    hour: {
                        last: {
                            new: thisHourNew,
                            duplicate: thisHourDup,
                        }
                    },
                    day: {
                        last: {
                            new: thisDayNew,
                            duplicate: thisDayDup,
                        }
                    },
                    month: {
                        last: {
                            new: thisMonthNew,
                            duplicate: thisMonthDup,
                        }
                    },
                    year: {
                        new: thisYearNew,
                        duplicate: thisYearDup,
                    }
                }
            }
        };
    }

}();


