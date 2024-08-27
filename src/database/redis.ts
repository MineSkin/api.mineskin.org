import { createClient, RedisClientType } from 'redis';
import * as Sentry from "@sentry/node";
import { Maybe, ONE_MONTH_SECONDS, ONE_YEAR_SECONDS } from "../util";
import { ClientInfo } from "../typings/ClientInfo";
import { Caching } from "../generator/Caching";

export let redisClient: Maybe<RedisClientType>;

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

export async function getRedisNextRequest(client: ClientInfo): Promise<number> {
    return Sentry.startSpan({
        op: "redis_getNextRequest",
        name: "Get Next Request",
    }, async span => {
        if (!redisClient) {
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

        let trans = redisClient.multi()
            .get(`mineskin:ratelimit:ip:${ cleanIp }:next`);
        if (client.apiKeyId) {
            trans = trans.get(`mineskin:ratelimit:apikey:${ client.apiKeyId }:next`);
        }

        const results = await trans.exec();
        const nextIpRequestStr = results[0] as string;
        const nextKeyRequestStr = client.apiKeyId ? results[1] as string : null;

        const nextIpRequest = nextIpRequestStr ? parseInt(nextIpRequestStr) : 0;
        const nextKeyRequest = nextKeyRequestStr ? parseInt(nextKeyRequestStr) : 0;

        return Math.max(nextIpRequest, nextKeyRequest);
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

        const prefix = 'mineskin:ratelimit';

        const nextRequest = client.time + effectiveDelayMs;
        client.nextRequest = nextRequest;

        // clean up ipv6 etc.
        const cleanIp = client.ip.replace(/[^a-zA-Z0-9]/g, '_');

        let trans = redisClient.multi();
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

        await trans.exec();
    });
}