import * as Sentry from "@sentry/node";
import { Maybe, ONE_MONTH_SECONDS, ONE_YEAR_SECONDS } from "../util";
import { ClientInfo } from "../typings/ClientInfo";
import { Caching } from "../generator/Caching";
import { container } from "tsyringe";
import { Log, RedisProvider } from "@mineskin/generator";

// export let redisClient: Maybe<RedisClientType>;
// export let redisPub: Maybe<RedisClientType>;
// export let redisSub: Maybe<RedisClientType>;

const setIfGreater = {
    script: `local current = redis.call('GET', KEYS[1])
if not current or tonumber(ARGV[1]) > tonumber(current) then
    redis.call('SET', KEYS[1], ARGV[1], 'EX', 3600)
    return 1
else
    return 0
end`,
    sha: "null"
}

// export async function initRedis() {
//     if (!process.env.REDIS_URI) return;
//     redisClient = createClient({
//         url: process.env.REDIS_URI
//     })
//     redisClient.on('error', (err: any) => {
//         console.error(`Redis error`, err);
//         Sentry.captureException(err);
//     });
//     redisClient = await redisClient.connect();
//
//     redisClient.scriptLoad(setIfGreater.script).then(sha => {
//         setIfGreater.sha = sha;
//     })
//
//     redisPub = createClient({
//         url: process.env.REDIS_URI
//     })
//     redisPub.on('error', (err: any) => {
//         console.error(`Redis error`, err);
//         Sentry.captureException(err);
//     });
//     redisPub = await redisPub.connect();
//
//     redisSub = createClient({
//         url: process.env.REDIS_URI
//     })
//     redisSub.on('error', (err: any) => {
//         console.error(`Redis error`, err);
//         Sentry.captureException(err);
//     });
//     redisSub = await redisSub.connect();
// }

export async function trackRedisGenerated(isNew: boolean, apiKey: Maybe<string>, userAgent: Maybe<string>) {
    return Sentry.startSpan({
        op: "redis_trackGenerated",
        name: "Track Generated Skin",
    }, async span => {
        const newOrDup = isNew ? "new" : "duplicate";

        const redis = container.resolve(RedisProvider);

        if (!redis.client) {
            return;
        }

        let trans = redis.client.multi();

        trans = trans.incr(`mineskin:generated:total:${ newOrDup }`);

        if (apiKey) {
            trackRedisGenerated0(trans, newOrDup, `mineskin:generated:apikey:${ apiKey }`);
        }
        if (userAgent) {
            trackRedisGenerated0(trans, newOrDup, `mineskin:generated:agent:${ userAgent.toLowerCase() }`);
        }

        await trans?.exec().catch(e => {
            Log.l.debug(e.replies);
            Log.l.debug(e.errorIndexes);
            Sentry.captureException(e, {
                extra: {
                    op: "redis_trackRedisGenerated",
                }
            });
            throw e;
        });
    });
}

function trackRedisGenerated0(trans: any, newOrDup: string, prefix: string) {
    const date = new Date();

    trans?.incr(`${ prefix }:alltime:${ newOrDup }`);

    trans?.incr(`${ prefix }:${ date.getFullYear() }:${ newOrDup }`, {
        EX: ONE_YEAR_SECONDS * 5
    });

    trans?.incr(`${ prefix }:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ newOrDup }`,{
        EX: ONE_YEAR_SECONDS * 2
    });

    trans?.incr(`${ prefix }:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ date.getDate() }:${ newOrDup }`,{
        EX: ONE_MONTH_SECONDS * 3
    });
}

export async function getRedisNextRequest(client: Pick<ClientInfo, 'ip' | 'apiKeyId' | 'time'>): Promise<number> {
    return Sentry.startSpan({
        op: "redis_getNextRequest",
        name: "Get Next Request",
    }, async span => {
        const redis = container.resolve(RedisProvider);
        if (!redis.client) {
            return 0;
        }

        // clean up ipv6 etc.
        const cleanIp = client.ip.replace(/[^a-zA-Z0-9]/g, '_');

        let cachedByIp = Caching.nextRequestByIpCache.getIfPresent(cleanIp);
        if (!!cachedByIp) {
            return cachedByIp;
        }
        if (client.apiKeyId) {
            let cachedByKey = Caching.nextRequestByKeyCache.getIfPresent(client.apiKeyId);
            if (!!cachedByKey) {
                return cachedByKey;
            }
        }

        let trans = redis.client.multi()
            .get(`mineskin:ratelimit:ip:${ cleanIp }:next`);
        if (client.apiKeyId) {
            trans = trans.get(`mineskin:ratelimit:apikey:${ client.apiKeyId }:next`);
        }

        const results = await trans.exec().catch(e => {
            Log.l.debug(e.replies);
            Log.l.debug(e.errorIndexes);
            Sentry.captureException(e, {
                extra: {
                    op: "redis_getRedisNextRequest",
                }
            });
            throw e;
        });
        const nextIpRequestStr = results[0] as string;
        const nextKeyRequestStr = client.apiKeyId ? results[1] as string : null;

        const nextIpRequest = nextIpRequestStr ? parseInt(nextIpRequestStr) : 0;
        const nextKeyRequest = nextKeyRequestStr ? parseInt(nextKeyRequestStr) : 0;

        return Math.max(nextIpRequest, nextKeyRequest);
    });
}

export async function getRedisLastRequest(client: Pick<ClientInfo, 'ip' | 'apiKeyId' | 'time'>): Promise<number> {
    return Sentry.startSpan({
        op: "redis_getLastRequest",
        name: "Get Last Request",
    }, async span => {
        const redis = container.resolve(RedisProvider);
        if (!redis.client) {
            return 0;
        }

        // clean up ipv6 etc.
        const cleanIp = client.ip.replace(/[^a-zA-Z0-9]/g, '_');

        let cachedByIp = Caching.nextRequestByIpCache.getIfPresent(cleanIp);
        if (!!cachedByIp) {
            return cachedByIp;
        }

        let trans = redis.client.multi()
            .get(`mineskin:ratelimit:ip:${ cleanIp }:last`);
        if (client.apiKeyId) {
            trans = trans.get(`mineskin:ratelimit:apikey:${ client.apiKeyId }:last`);
        }

        const results = await trans.exec().catch(e => {
            Log.l.debug(e.replies);
            Log.l.debug(e.errorIndexes);
            Sentry.captureException(e, {
                extra: {
                    op: "redis_getRedisLastRequest",
                }
            });
            throw e;
        });
        const lastIpRequestStr = results[0] as string;
        const lastKeyRequestStr = client.apiKeyId ? results[1] as string : null;

        const lastIpRequest = lastIpRequestStr ? parseInt(lastIpRequestStr) : 0;
        const lastKeyRequest = lastKeyRequestStr ? parseInt(lastKeyRequestStr) : 0;

        return Math.max(lastIpRequest, lastKeyRequest);
    });
}

export async function updateRedisNextRequest(client: ClientInfo, effectiveDelayMs: number) {
    return Sentry.startSpan({
        op: "redis_updateNextRequest",
        name: "Update Next Request",
    }, async span => {
        const redis = container.resolve(RedisProvider);
        if (!redis.client) {
            return;
        }

        const prefix = 'mineskin:ratelimit';

        const nextRequest = client.time + effectiveDelayMs;
        client.nextRequest = nextRequest;

        // clean up ipv6 etc.
        const cleanIp = client.ip.replace(/[^a-zA-Z0-9]/g, '_');

        let trans = redis.client.multi();
        if (client.apiKeyId) {
            Caching.nextRequestByKeyCache.put(client.apiKeyId, nextRequest);
            trans = trans.set(`${ prefix }:apikey:${ client.apiKeyId }:last`, client.time, {
                EX: 3600
            })
                .evalSha(setIfGreater.sha!, {
                    keys: [`${ prefix }:apikey:${ client.apiKeyId }:next`],
                    arguments: [`${ nextRequest }`]
                });
        }
        Caching.nextRequestByIpCache.put(cleanIp, nextRequest);
        trans = trans.set(`${ prefix }:ip:${ cleanIp }:last`, client.time, {
            EX: 3600
        })
            .evalSha(setIfGreater.sha!, {
                keys: [`${ prefix }:ip:${ cleanIp }:next`],
                arguments: [`${ nextRequest }`]
            });

        await trans.exec().catch(e => {
            Log.l.error("Failed to update next request", e);
            Log.l.debug(e.replies);
            Log.l.debug(e.errorIndexes);
            Sentry.captureException(e, {
                extra: {
                    op: "redis_updateRedisNextRequest",
                }
            });
            throw e;
        });
    });
}