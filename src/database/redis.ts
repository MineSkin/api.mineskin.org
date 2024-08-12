import { createClient, RedisClientType } from 'redis';
import * as Sentry from "@sentry/node";
import { Maybe, ONE_MONTH_SECONDS, ONE_YEAR_SECONDS } from "../util";

export let redisClient: Maybe<RedisClientType>;

export async function initRedis() {
    if (!process.env.REDIS_URI) return;
    redisClient = createClient({
        url: process.env.REDIS_URI
    })
    redisClient.on('error', (err: any) => {
        console.error(`Redis error`, err);
        Sentry.captureException(err);
    });
    redisClient = await redisClient.connect();
}

export async function trackRedisGenerated(isNew: boolean, apiKey: Maybe<string>, userAgent: Maybe<string>) {
    return Sentry.startSpan({
        op: "redis_trackGenerated",
        name: "Track Generated Skin",
    }, async span => {
        const newOrDup = isNew ? "new" : "duplicate";

        if (!redisClient) {
            return;
        }

        let trans = redisClient.multi();

        trans = trans.incr(`mineskin:generated:total:${ newOrDup }`);

        if (apiKey) {
            trackRedisGenerated0(trans, newOrDup, `mineskin:generated:apikey:${ apiKey }`);
        }
        if (userAgent) {
            trackRedisGenerated0(trans, newOrDup, `mineskin:generated:agent:${ userAgent.toLowerCase() }`);
        }

        await trans?.exec();
    });
}

function trackRedisGenerated0(trans: any, newOrDup: string, prefix: string) {
    const date = new Date();

    trans?.incr(`${ prefix }:alltime:${ newOrDup }`);

    trans?.incr(`${ prefix }:${ date.getFullYear() }:${ newOrDup }`);
    trans?.expire(`${ prefix }:${ date.getFullYear() }:${ newOrDup }`, ONE_YEAR_SECONDS * 5);

    trans?.incr(`${ prefix }:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ newOrDup }`);
    trans?.expire(`${ prefix }:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ newOrDup }`, ONE_YEAR_SECONDS * 2);

    trans?.incr(`${ prefix }:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ date.getDate() }:${ newOrDup }`);
    trans?.expire(`${ prefix }:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ date.getDate() }:${ newOrDup }`, ONE_MONTH_SECONDS * 3);
}