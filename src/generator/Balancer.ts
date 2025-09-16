import { MineSkinConfig } from "../typings/Configs";
import { Requests } from "./Requests";
import { warn } from "../util/colors";
import { sleep } from "../util";
import { Discord } from "../util/Discord";
import { TYPES as CoreTypes } from "@mineskin/core";
import { container } from "../inversify.config";
import { HOSTNAME } from "../util/host";
import { RedisProvider } from "@mineskin/generator";
import * as Sentry from "@sentry/node";

export class Balancer {

    public static async disableSelfPoolForMaintenance(config: MineSkinConfig): Promise<void> {
        const redis = container.get<RedisProvider>(CoreTypes.RedisProvider);
        let foundOrigin = false;
        for (let poolId of config.cloudflare.pools) {
            try {
                const currentPoolConfigResponse = await this.getPoolDetails(config, poolId);
                if (!currentPoolConfigResponse.success) {
                    console.warn(warn("failed to get pool config for " + poolId));
                    console.warn(currentPoolConfigResponse);
                    continue;
                }
                const currentPoolConfig = currentPoolConfigResponse.result;
                const currentOriginConfig = currentPoolConfig.origins;
                let madeChanges = false;
                const newOriginConfig = [];
                for (let origin of currentOriginConfig) {
                    if (!origin.enabled || origin.name !== HOSTNAME) {
                        newOriginConfig.push(origin);
                        continue;
                    }
                    foundOrigin = true;
                    console.info(`Disabling ${ origin.name } for maintenance`);
                    await redis.client.set(`mineskin:balancer:${ origin.name }:pre_maintenance_weight`, `${ origin.weight }`);
                    let newOrigin: Origin = {
                        ...origin,
                        weight: 0
                    }
                    newOriginConfig.push(newOrigin);
                    if (newOrigin.weight !== origin.weight) {
                        madeChanges = true;
                    }
                }

                if (madeChanges && newOriginConfig.length === currentOriginConfig.length) {
                    console.log(JSON.stringify(newOriginConfig));
                    const updateResponse = await this.patchPoolOrigins(config, poolId, newOriginConfig);
                    console.log(JSON.stringify(updateResponse));
                    if (!updateResponse.success) {
                        console.warn(warn("failed to update pool config for " + poolId));
                        console.warn(updateResponse);
                        continue;
                    }
                    await sleep(1000);
                    break; // only need to update one origin
                }
            } catch (e) {
                Sentry.captureException(e);
                console.warn(warn("exception while updating pool config for " + poolId));
                console.error(e);
                if ("response" in e) {
                    console.warn(e.response);
                    if ("data" in e.response) {
                        console.warn(JSON.stringify(e.response.data));
                    }
                }
                continue;
            }
        }
        if (!foundOrigin) {
            console.warn(warn("No CF origin found for " + HOSTNAME));
        }
    }

    public static async restoreSelfPoolAfterMaintenance(config: MineSkinConfig): Promise<void> {
        const redis = container.get<RedisProvider>(CoreTypes.RedisProvider);
        const preMaintenanceWeight = await redis.client.get(`mineskin:balancer:${ HOSTNAME }:pre_maintenance_weight`);
        if (!preMaintenanceWeight) {
            console.warn(warn(`No pre-maintenance weight found for ${ HOSTNAME }`));
            return;
        }
        for (let poolId of config.cloudflare.pools) {
            try {
                const currentPoolConfigResponse = await this.getPoolDetails(config, poolId);
                if (!currentPoolConfigResponse.success) {
                    console.warn(warn("failed to get pool config for " + poolId));
                    console.warn(currentPoolConfigResponse);
                    continue;
                }
                const currentPoolConfig = currentPoolConfigResponse.result;
                const currentOriginConfig = currentPoolConfig.origins;
                let madeChanges = false;
                const newOriginConfig = [];
                for (let origin of currentOriginConfig) {
                    if (!origin.enabled || origin.name !== HOSTNAME) {
                        newOriginConfig.push(origin);
                        continue;
                    }
                    console.info(`Restoring ${ origin.name } after maintenance (to weight ${ preMaintenanceWeight })`);
                    let newOrigin: Origin = {
                        ...origin,
                        weight: parseFloat(preMaintenanceWeight) || 1
                    }
                    newOriginConfig.push(newOrigin);
                    if (newOrigin.weight !== origin.weight) {
                        madeChanges = true;
                    }
                }

                if (madeChanges && newOriginConfig.length === currentOriginConfig.length) {
                    console.log(JSON.stringify(newOriginConfig));
                    const updateResponse = await this.patchPoolOrigins(config, poolId, newOriginConfig);
                    console.log(JSON.stringify(updateResponse));
                    if (!updateResponse.success) {
                        console.warn(warn("failed to update pool config for " + poolId));
                        console.warn(updateResponse);
                        continue;
                    }
                    break; // only need to update one origin
                }
            } catch (e) {
                Sentry.captureException(e);
                console.warn(warn("exception while updating pool config for " + poolId));
                console.error(e);
                if ("response" in e) {
                    console.warn(e.response);
                    if ("data" in e.response) {
                        console.warn(JSON.stringify(e.response.data));
                    }
                }
                continue;
            }
        }
    }

    private static async getPoolDetails(config: MineSkinConfig, pool: string): Promise<CloudflareResponse<Pool>> {
        return Requests.genericRequest({
            method: "GET",
            baseURL: "https://api.cloudflare.com/client/v4/",
            url: `accounts/${ config.cloudflare.account }/load_balancers/pools/${ pool }`,
            headers: {
                "Authorization": `Bearer ${ config.cloudflare.token }`
            }
        }).then(res => res.data as CloudflareResponse<Pool>);
    }

    private static async patchPoolOrigins(config: MineSkinConfig, pool: string, origins: Origin[]) {
        return Requests.genericRequest({
            method: "PATCH",
            baseURL: "https://api.cloudflare.com/client/v4/",
            url: `accounts/${ config.cloudflare.account }/load_balancers/pools/${ pool }`,
            headers: {
                "Authorization": `Bearer ${ config.cloudflare.token }`,
                "Content-Type": 'application/json'
            },
            data: JSON.stringify({
                origins: origins
            })
        }).then(res => res.data as CloudflareResponse<any>);
    }

}

interface CloudflareResponse<C> {
    success: boolean;
    result: C;
}

interface Pool {
    id: string;
    name: string;
    enabled: boolean;
    origins: Origin[];
}

interface Origin {
    name: string;
    address: string;
    enabled: boolean;
    weight: number;
}
