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
    });
    redisClient = await redisClient.connect();
}

export async function trackRedisGenerated(isNew: boolean, apiKey: Maybe<string>, userAgent: Maybe<string>) {
    return Sentry.startSpan({
        op: "redis_trackGenerated"
    }, async span => {
        const newOrDup = isNew ? "new" : "duplicate";

        let trans = redisClient?.multi();

        trans = trans?.incr(`mineskin:generated:total:${ newOrDup }`);

        const date = new Date();

        if (apiKey) {
            const apiKeyPrefix = `mineskin:generated:apikey:${ apiKey }`;

            trans?.incr(`${ apiKeyPrefix }:alltime:${ newOrDup }`);

            trans?.incr(`${ apiKeyPrefix }:${ date.getFullYear() }:${ newOrDup }`);
            trans?.expire(`${ apiKeyPrefix }:${ date.getFullYear() }:${ newOrDup }`, ONE_YEAR_SECONDS * 2);

            trans?.incr(`${ apiKeyPrefix }:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ newOrDup }`);
            trans?.expire(`${ apiKeyPrefix }:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ newOrDup }`, ONE_YEAR_SECONDS);

            trans?.incr(`${ apiKeyPrefix }:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ date.getDate() }:${ newOrDup }`);
            trans?.expire(`${ apiKeyPrefix }:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ date.getDate() }:${ newOrDup }`, ONE_MONTH_SECONDS);
        }

        await trans?.exec();
    });
}