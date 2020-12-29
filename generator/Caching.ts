import { Requests } from "./Requests";
import { AsyncLoadingCache, Caches, Time } from "@inventivetalent/loading-cache";
import { SkinData } from "../types/SkinData";
import { ProfileResponse } from "../types/ProfileResponse";

export class Caching {

    protected static readonly skinDataCache: AsyncLoadingCache<string, SkinData | undefined> = Caches.builder()
        .expireAfterWrite(Time.minutes(2))
        .expirationInterval(Time.seconds(30))
        .buildAsync<string, SkinData | undefined>(uuid => {
            return Requests.mojangSessionRequest({
                url: "/session/minecraft/profile/" + uuid + "?unsigned=false"
            }).then(response => {
                if (response.status < 200 || response.status > 230) {
                    return undefined;
                }
                if (!response.data.hasOwnProperty("properties")) {
                    return undefined;
                }
                const body = response.data as ProfileResponse;
                return body.properties[0] as SkinData;
            })
        });

    public static getSkinData(uuid: string): Promise<SkinData | undefined> {
        return this.skinDataCache.get(uuid);
    }

}
