import { Requests } from "./Requests";
import { AsyncLoadingCache, Caches, LoadingCache, Time } from "@inventivetalent/loading-cache";
import { SkinData } from "../types/SkinData";
import { ProfileResponse } from "../types/ProfileResponse";
import { User } from "../types/User";
import * as Sentry from "@sentry/node";
import { Severity } from "@sentry/node";
import { metrics, stripUuid } from "../util";
import { IPoint } from "influx";


export class Caching {

    protected static readonly skinDataCache: AsyncLoadingCache<string, SkinData | undefined> = Caches.builder()
        .expireAfterWrite(Time.minutes(2))
        .expirationInterval(Time.seconds(30))
        .buildAsync<string, SkinData | undefined>(uuid => {
            return Requests.mojangSessionRequest({
                url: "/session/minecraft/profile/" + uuid + "?unsigned=false"
            }).then(response => {
                if (!Requests.isOk(response) || !response.data.hasOwnProperty("properties")) {
                    return undefined;
                }
                const body = response.data as ProfileResponse;
                return body.properties[0] as SkinData;
            }).catch(err => {
                Sentry.captureException(err, {
                    level: Severity.Warning,
                    tags: {
                        cache: "skinData"
                    }
                });
                return undefined;
            });
        });

    protected static readonly userByNameCache: AsyncLoadingCache<string, User | undefined> = Caches.builder()
        .expireAfterWrite(Time.minutes(5))
        .expirationInterval(Time.minutes(1))
        .buildAsync<string, User | undefined>(name => {
            return Requests.mojangApiRequest({
                url: "/users/profiles/minecraft/" + name
            }).then(response => {
                let d = {
                    valid: false,
                    uuid: undefined,
                    name: name
                } as User;
                if (Requests.isOk(response) && (response.data && response.data.hasOwnProperty("id"))) {
                    const body = response.data;
                    d = {
                        valid: true,
                        uuid: body["id"],
                        name: body["name"]
                    } as User;
                    Caching.userByUuidCache.put(d.uuid, d);
                }
                return d;
            }).catch(err => {
                Sentry.captureException(err, {
                    level: Severity.Warning,
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
    protected static readonly userByUuidCache: AsyncLoadingCache<string, User | undefined> = Caches.builder()
        .expireAfterWrite(Time.minutes(5))
        .expirationInterval(Time.minutes(1))
        .buildAsync<string, User | undefined>(uuid => {
            uuid = stripUuid(uuid);
            return Requests.mojangApiRequest({
                url: "/user/profiles/" + uuid + "/names"
            }).then(response => {
                let d = {
                    valid: false,
                    uuid: uuid,
                    name: undefined
                } as User;
                if (Requests.isOk(response) && (response.data && response.data.length > 0)) {
                    const body = response.data;
                    d = {
                        valid: true,
                        uuid: uuid,
                        name: body[body.length - 1]["name"]
                    } as User;
                    Caching.userByNameCache.put(d.name.toLowerCase(), d);
                }
                return d;
            }).catch(err => {
                Sentry.captureException(err, {
                    level: Severity.Warning,
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

    protected static metricsCollector = setInterval(() => {
        const caches = new Map<string, AsyncLoadingCache<string, any>>([
            ["skinData", Caching.skinDataCache],
            ["userByName", Caching.userByNameCache],
            ["userByUuid", Caching.userByUuidCache]
        ]);
        const points: IPoint[] = [];
        caches.forEach((cache, name) => {
            points.push({
                measurement: "cache." + name,
                tags: {
                    server: config.server
                },
                fields: {
                    size: cache.keys().length
                }
            });
        });
        try {
            metrics.influx.writePoints(points);
        } catch (e) {
            Sentry.captureException(e);
        }
    }, 10000);

    public static getSkinData(uuid: string): Promise<SkinData | undefined> {
        return this.skinDataCache.get(uuid);
    }

    public static getUserByName(name: string): Promise<User> {
        return this.userByNameCache.get(name.toLowerCase());
    }

    public static getUserByUuid(uuid: string): Promise<User> {
        return this.userByUuidCache.get(uuid);
    }

    public static end() {
        this.skinDataCache.end();
        this.userByNameCache.end();
        this.userByUuidCache.end();

        clearInterval(this.metricsCollector);
    }

}
