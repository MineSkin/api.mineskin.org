import { createClient, RedisClientType } from 'redis';
import * as Sentry from "@sentry/node";
import { Maybe, ONE_MONTH_SECONDS, ONE_YEAR_SECONDS } from "../util";
import { ClientInfo } from "../typings/ClientInfo";

export let redisClient: Maybe<RedisClientType>;

const setIfGreater = {
    script: `local current = redis.call('GET', KEYS[1])
if not current or tonumber(ARGV[1]) > tonumber(current) then
    redis.call('SET', KEYS[1], ARGV[1])
    return 1
else
    return 0
end`,
    sha: "null"
}

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

    redisClient.scriptLoad(setIfGreater.script).then(sha => {
        setIfGreater.sha = sha;
    })
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

export async function getRedisNextRequest(client: ClientInfo) {
    return Sentry.startSpan({
        op: "redis_getNextRequest",
        name: "Get Next Request",
    }, async span => {
        if (!redisClient) {
            return 0;
        }

        let key = 'mineskin:ratelimit';
        if (client.apiKeyId) {
            key += `:apikey:${ client.apiKeyId }`;
        } else {
            key += `:ip:${ client.ip }`;
        }

        const nextRequestStr = await redisClient.get(key + ':next');
        return nextRequestStr ? parseInt(nextRequestStr) : 0;
    });
}

export async function updateRedisNextRequest(client: ClientInfo, effectiveDelayMs: number) {
    return Sentry.startSpan({
        op: "redis_updateNextRequest",
        name: "Update Next Request",
    }, async span => {
        if (!redisClient) {
            return;
        }

        let key = 'mineskin:ratelimit';
        if (client.apiKeyId) {
            key += `:apikey:${ client.apiKeyId }`;
        } else {
            key += `:ip:${ client.ip }`;
        }

        const nextRequest = client.time + effectiveDelayMs;

        await redisClient.multi()
            .set(key + ':last', client.time)
            .evalSha(setIfGreater.sha!, {
                keys: [key + ':next'],
                arguments: [`${ nextRequest }`]
            })
            .exec();
    });
}