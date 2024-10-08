import { MOJANG_API, MOJANG_SESSION, Requests } from "./Requests";
import {
    AsyncLoadingCache,
    Caches,
    CacheStats,
    ICacheBase,
    LoadingCache,
    SimpleCache
} from "@inventivetalent/loading-cache";
import * as Sentry from "@sentry/node";
import { Maybe, sha512, stripUuid } from "../util";
import { IPoint } from "influx";
import { BasicMojangProfile } from "./Authentication";
import { ProfileSkinData } from "../typings/SkinData";
import { User } from "../typings/User";
import { ProfileResponse } from "../typings/ProfileResponse";
import { MineSkinMetrics } from "../util/metrics";
import { Bread } from "../typings/Bread";
import { IPendingDiscordLink } from "../typings/DiscordAccountLink";
import { Time } from "@inventivetalent/time";
import { MojangAccountLink } from "../typings/MojangAccountLink";
import { redisSub } from "../database/redis";
import { ApiKey, IApiKeyDocument, ISkinDocument, Skin, Traffic } from "@mineskin/database";

export class Caching {

    //// REQUESTS

    protected static readonly skinDataCache: AsyncLoadingCache<string, ProfileSkinData> = Caches.builder()
        .expireAfterWrite(Time.seconds(30))
        .expirationInterval(Time.seconds(10))
        .buildAsync<string, ProfileSkinData>(uuid => {
            return Requests.dynamicRequestWithRandomProxy(MOJANG_SESSION, {
                url: "/session/minecraft/profile/" + uuid + "?unsigned=false&t=" + Date.now(),
            }).then(response => {
                if (!Requests.isOk(response) || !response.data.hasOwnProperty("properties")) {
                    return undefined;
                }
                const body = response.data as ProfileResponse;
                return body.properties[0] as ProfileSkinData;
            }).catch(err => {
                Sentry.captureException(err, {
                    level: 'warning',
                    tags: {
                        cache: "skinData"
                    }
                });
                return undefined;
            });
        });

    protected static readonly userByNameCache: AsyncLoadingCache<string, User> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expirationInterval(Time.minutes(1))
        .buildAsync<string, User>(name => {
            return Requests.dynamicRequestWithRandomProxy(MOJANG_API, {
                url: "/users/profiles/minecraft/" + name,
            }).then(response => {
                let d = {
                    valid: false,
                    uuid: undefined,
                    name: name
                } as User;
                if (Requests.isOk(response)) {
                    if (response.data && response.data.hasOwnProperty("id")) {
                        const body = response.data;
                        d = {
                            valid: true,
                            uuid: body["id"],
                            name: body["name"]
                        } as User;
                        // update other cache
                        Caching.userByUuidCache.put(d.uuid!, d);
                    }
                } else {
                    console.warn(response)
                }
                return d;
            }).catch(err => {
                console.warn(err);
                Sentry.captureException(err, {
                    level: 'warning',
                    tags: {
                        cache: "userByName"
                    }
                });
                return {
                    valid: false,
                    uuid: undefined,
                    name: name
                } as User;
            });
        });
    protected static readonly userByUuidCache: AsyncLoadingCache<string, User> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expirationInterval(Time.minutes(1))
        .buildAsync<string, User>(uuid => {
            uuid = stripUuid(uuid);
            return Requests.dynamicRequestWithRandomProxy(MOJANG_SESSION, {
                url: "/session/minecraft/profile/" + uuid
            }).then(response => {
                let d = {
                    valid: false,
                    uuid: uuid,
                    name: undefined
                } as User;
                if (Requests.isOk(response)) {
                    if (response.data && response.data.hasOwnProperty("name")) {
                        const body = response.data;
                        d = {
                            valid: true,
                            uuid: uuid,
                            name: body["name"]
                        } as User;
                        // update other cache
                        Caching.userByNameCache.put(d.name!.toLowerCase(), d);
                    }
                } else {
                    console.warn(response)
                }
                return d;
            }).catch(err => {
                console.warn(err);
                Sentry.captureException(err, {
                    level: 'warning',
                    tags: {
                        cache: "userByUuid"
                    }
                });
                return {
                    valid: false,
                    uuid: uuid,
                    name: undefined
                } as User;
            });
        });

    protected static readonly profileByAccessTokenCache: AsyncLoadingCache<string, BasicMojangProfile> = Caches.builder()
        .expireAfterWrite(Time.minutes(5))
        .expirationInterval(Time.seconds(30))
        .buildAsync<string, BasicMojangProfile>(accessToken => {
            return Requests.minecraftServicesProfileRequest({
                method: "GET",
                url: "/minecraft/profile",
                headers: {
                    "Authorization": `Bearer ${ accessToken }`
                }
            }).then(response => {
                return response.data as BasicMojangProfile
            }).catch(err => {
                Sentry.captureException(err, {
                    level: 'warning',
                    tags: {
                        cache: "profileByAccessToken"
                    }
                });
                return undefined;
            });
        })

    //// DATABASE

    protected static readonly trafficByIpCache: AsyncLoadingCache<string, Date> = Caches.builder()
        .expireAfterWrite(Time.seconds(1))
        .expirationInterval(Time.seconds(1))
        .buildAsync<string, Date>(async (ip) => {
            const traffic = await Traffic.findForIp(ip);
            return traffic?.lastRequest;
        });
    protected static readonly trafficByKeyCache: AsyncLoadingCache<string, Date> = Caches.builder()
        .expireAfterWrite(Time.seconds(1))
        .expirationInterval(Time.seconds(1))
        .buildAsync<string, Date>(async (key) => {
            const traffic = await Traffic.findForKey(key);
            return traffic?.lastRequest;
        });

    public static readonly nextRequestByIpCache: SimpleCache<string, number> = Caches.builder()
        .expireAfterWrite(Time.millis(100))
        .expirationInterval(Time.seconds(1))
        .build<string, number>();
    public static readonly nextRequestByKeyCache: SimpleCache<string, number> = Caches.builder()
        .expireAfterWrite(Time.millis(100))
        .expirationInterval(Time.seconds(1))
        .build<string, number>();

    protected static readonly skinByIdCache: AsyncLoadingCache<number, ISkinDocument> = Caches.builder()
        .expireAfterWrite(Time.minutes(1))
        .expirationInterval(Time.seconds(30))
        .buildAsync<number, ISkinDocument>(id => Skin.findForId(id));

    protected static readonly skinByUuidCache: AsyncLoadingCache<string, ISkinDocument> = Caches.builder()
        .expireAfterWrite(Time.minutes(1))
        .expirationInterval(Time.seconds(30))
        .buildAsync<string, ISkinDocument>(id => Skin.findForUuid(id));

    protected static readonly apiKeyCache: AsyncLoadingCache<string, IApiKeyDocument> = Caches.builder()
        .expireAfterWrite(Time.minutes(5))
        .expireAfterAccess(Time.minutes(1))
        .expirationInterval(Time.seconds(20))
        .buildAsync<string, IApiKeyDocument>(key => ApiKey.findByKeyHash(key));

    protected static readonly skinDocumentCounts: AsyncLoadingCache<string, number> = Caches.builder()
        .expireAfterWrite(Time.minutes(20))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(30))
        .buildAsync<string, number>(key => Skin.countDocuments(JSON.parse(key)).exec());

    //// OTHER

    protected static readonly pendingDiscordLinkByStateCache: SimpleCache<string, IPendingDiscordLink> = Caches.builder()
        .expireAfterWrite(Time.minutes(5))
        .expirationInterval(Time.seconds(30))
        .build();

    protected static readonly pendingMicrosoftLinkByStateCache: SimpleCache<string, MojangAccountLink> = Caches.builder()
        .expireAfterWrite(Time.minutes(5))
        .expirationInterval(Time.seconds(30))
        .build();

    protected static readonly recentAccountsLock: SimpleCache<number, string> = Caches.builder()
        .expireAfterWrite(Time.seconds(30))
        .expirationInterval(Time.seconds(10))
        .build();

    protected static readonly hashCache: LoadingCache<string, string> = Caches.builder()
        .expireAfterAccess(Time.seconds(40))
        .expirationInterval(Time.seconds(10))
        .build(key => sha512(key));

    protected static readonly loginNonceCache: SimpleCache<string, string> = Caches.builder()
        .expireAfterWrite(Time.seconds(30))
        .build();

    ////

    protected static metricsCollector = setInterval(async () => {
        const metrics = await MineSkinMetrics.get();
        const caches = new Map<string, ICacheBase<any, any>>([
            ["skinData", Caching.skinDataCache],
            ["userByName", Caching.userByNameCache],
            ["userByUuid", Caching.userByUuidCache],
            ["profileByAccessToken", Caching.profileByAccessTokenCache],

            ["trafficById", Caching.trafficByIpCache],
            ["skinById", Caching.skinByIdCache],
            ["skinByUuid", Caching.skinByUuidCache],
            ["apiKeys", Caching.apiKeyCache],
            ["skinDocumentCounts", Caching.skinDocumentCounts],

            ["pendingDiscordLinks", Caching.pendingDiscordLinkByStateCache],
            ["accountLock", Caching.recentAccountsLock],
            ["hashes", Caching.hashCache]
        ]);
        const points: IPoint[] = [];
        caches.forEach((cache, name) => {
            points.push({
                measurement: "caches",
                tags: {
                    cache: name,
                    server: metrics.config.server
                },
                fields: {
                    size: cache.keys().length,
                    hit: cache.stats.get(CacheStats.HIT),
                    miss: cache.stats.get(CacheStats.MISS),
                    loadSuccess: cache.stats.get(CacheStats.LOAD_SUCCESS),
                    loadFail: cache.stats.get(CacheStats.LOAD_FAIL),
                    expire: cache.stats.get(CacheStats.EXPIRE)
                }
            });

            cache.stats.reset();
        });
        try {
            metrics.metrics!.influx.writePoints(points, {
                precision: 'ms'
            });
        } catch (e) {
            Sentry.captureException(e);
        }
    }, 20000);

    public static subscribeToRedis() {
        redisSub?.subscribe('mineskin:invalidations:apikey', (message, channel) => {
            console.log('Received apikey invalidation message', message, channel);
            this.apiKeyCache.invalidate(message);
        })
    }

    /// REQUESTS

    public static getSkinData(uuid: string): Promise<ProfileSkinData> {
        return this.skinDataCache.get(uuid);
    }

    public static getUserByName(name: string): Promise<User> {
        return this.userByNameCache.get(name.toLowerCase());
    }

    public static getUserByUuid(uuid: string): Promise<User> {
        return this.userByUuidCache.get(uuid);
    }

    public static getProfileByAccessToken(accessToken: string): Promise<Maybe<BasicMojangProfile>> {
        return this.profileByAccessTokenCache.get(accessToken);
    }

    /// DATABASE

    /**@deprecated*/
    public static getTrafficRequestTimeByIp(ip: string): Promise<Maybe<Date>> {
        return this.trafficByIpCache.get(ip);
    }

    /**@deprecated*/
    public static getTrafficRequestTimeByApiKey(key: IApiKeyDocument): Promise<Maybe<Date>> {
        return this.trafficByKeyCache.get(key._id as string);
    }

    /**@deprecated*/
    public static getTrafficRequestTimeByKey(key: string): Promise<Maybe<Date>> {
        return this.trafficByKeyCache.get(key);
    }

    /**@deprecated*/
    public static async updateTrafficRequestTime(ip: string, key: string | null, time: Date): Promise<any> {
        this.trafficByIpCache.put(ip, time);
        if (key) {
            this.trafficByKeyCache.put(key, time);
        }
        return await Traffic.updateRequestTime(ip, key, time);
    }

    public static getSkinById(id: number): Promise<Maybe<ISkinDocument>> {
        return this.skinByIdCache.get(id);
    }

    public static getSkinByUuid(id: string): Promise<Maybe<ISkinDocument>> {
        return this.skinByUuidCache.get(id);
    }

    public static getApiKey(key: string): Promise<Maybe<IApiKeyDocument>> {
        return this.apiKeyCache.get(key);
    }

    public static getSkinDocumentCount(query: any): Promise<number> {
        return this.skinDocumentCounts.get(query ? JSON.stringify(query) : "ALL");
    }

    /// OTHER

    public static storePendingDiscordLink(pendingLink: IPendingDiscordLink): void {
        this.pendingDiscordLinkByStateCache.put(pendingLink.state, pendingLink);
    }

    public static getPendingDiscordLink<T extends IPendingDiscordLink>(state: string): Maybe<T> {
        return this.pendingDiscordLinkByStateCache.getIfPresent(state) as T;
    }

    public static storePendingMicrosoftLink(state: string, link: MojangAccountLink): void {
        this.pendingMicrosoftLinkByStateCache.put(state, link);
    }

    public static getPendingMicrosoftLink(state: string): Maybe<MojangAccountLink> {
        return this.pendingMicrosoftLinkByStateCache.getIfPresent(state) as MojangAccountLink;
    }

    public static invalidatePendingDiscordLink(state: string): void {
        this.pendingDiscordLinkByStateCache.invalidate(state);
    }

    public static lockSelectedAccount(accountId: number, bread?: Bread): void {
        this.recentAccountsLock.put(accountId, bread?.breadcrumb ?? `${ accountId }`);
    }

    public static getLockedAccounts(): number[] {
        return this.recentAccountsLock.keys();
    }

    public static isAccountLocked(accountId: number): boolean {
        return !!this.recentAccountsLock.getIfPresent(accountId);
    }

    public static cachedSha512(str: string): string {
        return this.hashCache.get(str)!;
    }

    public static putLoginNonce(k: string, v: string) {
        this.loginNonceCache.put(k, v);
    }

    public static getLoginNonce(k: string): Maybe<string> {
        const v = this.loginNonceCache.getIfPresent(k);
        this.loginNonceCache.invalidate(k);
        return v;
    }

    ///

    public static end() {
        this.skinDataCache.end();
        this.userByNameCache.end();
        this.userByUuidCache.end();

        clearInterval(this.metricsCollector);
    }

}
