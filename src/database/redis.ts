import { createClient, RedisClientType } from 'redis';
import { Maybe } from "../util";

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