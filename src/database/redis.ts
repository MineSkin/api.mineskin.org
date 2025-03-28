import * as Sentry from "@sentry/node";
import { Maybe, ONE_MONTH_SECONDS, ONE_YEAR_SECONDS } from "../util";
import { ClientInfo } from "../typings/ClientInfo";
import { Caching } from "../generator/Caching";
import { IRedisProvider, TYPES as CoreTypes } from "@mineskin/core";
import { container } from "../inversify.config";
import { Log } from "../Log";

// export let redisClient: Maybe<RedisClientType>;
// export let redisPub: Maybe<RedisClientType>;
// export let redisSub: Maybe<RedisClientType>;

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

        const redis = container.get<IRedisProvider>(CoreTypes.RedisProvider);

        if (!redis.client) {
            Log.l.warn("No redis client");
            return;
        }

        const date = new Date();

        let trans = redis.client.multi();

        trans = trans.incr(`mineskin:generated:total:${ newOrDup }`);
        trackRedisGenerated0(trans, newOrDup, `mineskin:generated:global`);
        let key = `mineskin:generated:global:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ date.getDate() }:${ date.getHours() }:${ newOrDup }`;
        trans.incr(key);
        trans.expire(key, ONE_MONTH_SECONDS);

        if (apiKey) {
            trackRedisGenerated0(trans, newOrDup, `mineskin:generated:apikey:${ apiKey }`);
        }
        if (userAgent) {
            trackRedisGenerated0(trans, newOrDup, `mineskin:generated:agent:${ userAgent.toLowerCase() }`);
        }

        await trans.exec().catch(e => {
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

    trans.incr(`${ prefix }:alltime:${ newOrDup }`);

    let key = `${ prefix }:${ date.getFullYear() }:${ newOrDup }`;
    trans.incr(key);
    trans.expire(key, ONE_YEAR_SECONDS * 5);

    key = `${ prefix }:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ newOrDup }`;
    trans.incr(key);
    trans.expire(key, ONE_YEAR_SECONDS * 2);

    key = `${ prefix }:${ date.getFullYear() }:${ date.getMonth() + 1 }:${ date.getDate() }:${ newOrDup }`;
    trans.incr(key);
    trans.expire(key, ONE_MONTH_SECONDS * 3);
}

export async function getRedisNextRequest(client: Pick<ClientInfo, 'ip' | 'apiKeyId' | 'time'>): Promise<number> {
    return Sentry.startSpan({
        op: "redis_getNextRequest",
        name: "Get Next Request",
    }, async span => {
        const redis = container.get<IRedisProvider>(CoreTypes.RedisProvider);
        if (!redis.client) {
            Log.l.warn("No redis client");
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
        const redis = container.get<IRedisProvider>(CoreTypes.RedisProvider);
        if (!redis.client) {
            Log.l.warn("No redis client");
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
        const redis = container.get<IRedisProvider>(CoreTypes.RedisProvider);
        if (!redis.client) {
            Log.l.warn("No redis client");
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
                .evalSha(redis.scripts.setIfGreaterEX.sha!, {
                    keys: [`${ prefix }:apikey:${ client.apiKeyId }:next`],
                    arguments: [`${ nextRequest }`]
                });
        }
        Caching.nextRequestByIpCache.put(cleanIp, nextRequest);
        trans = trans.set(`${ prefix }:ip:${ cleanIp }:last`, client.time, {
            EX: 3600
        })
            .evalSha(redis.scripts.setIfGreaterEX.sha!, {
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
                    apiKeyId: client.apiKeyId,
                    cleanIp: cleanIp
                }
            });
            throw e;
        });
    });
}