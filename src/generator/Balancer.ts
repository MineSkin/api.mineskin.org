import { getConfig, MineSkinConfig } from "../typings/Configs";
import { Requests } from "./Requests";
import { debug, info, warn } from "../util/colors";
import { sleep } from "../util";
import { Discord } from "../util/Discord";
import { AccountType } from "@mineskin/types";
import { Account } from "@mineskin/database";
import { IFlagProvider, TYPES as CoreTypes } from "@mineskin/core";
import { container } from "../inversify.config";
import { HOSTNAME } from "../util/host";
import { RedisProvider } from "@mineskin/generator";
import * as Sentry from "@sentry/node";

export class Balancer {


    static async balance(): Promise<void> {
        console.log(info("Balancing servers..."));

        const flags = container.get<IFlagProvider>(CoreTypes.FlagProvider);
        if (await flags.isEnabled('balancer.disabled')) {
            console.log(warn("Balancer is disabled"));
            return;
        }

        const config: MineSkinConfig = await getConfig();
        await this.balanceAccounts(config);
        await sleep(1000);
        await this.updateLoadBalancer(config);
    }

    private static async balanceAccounts(config: MineSkinConfig): Promise<void> {
        const accountsPerServer = await this.getAccountsPerServer(config);

        let lowest = {
            name: "",
            count: 1000
        };
        let highest = {
            name: "",
            count: 0
        };
        for (let k in accountsPerServer) {
            if (k === "null") continue;
            let c = accountsPerServer[k];
            if (c < lowest.count) {
                lowest.count = c;
                lowest.name = k;
            }
            if (c > highest.count) {
                highest.count = c;
                highest.name = k;
            }
        }

        console.log(debug("Account Balance:"));
        console.log(debug("highest: " + highest.count + ": " + highest.name + ""))
        console.log(debug("lowest:  " + lowest.count + ": " + lowest.name + ""))
        if (!highest.name || highest.name.length <= 0 || !lowest.name || lowest.name.length <= 0) {
            console.log(debug("not balancing because no servers"));
            return;
        }
        if (lowest.name === "null") {
            console.log(warn("null lowest server"));
            return;
        }
        if (highest.count - lowest.count <= 1) {
            console.log(debug("not balancing because diff <= 1"));
            return;
        }

        let toMove = Math.round((highest.count - lowest.count) * 0.3);
        toMove = Math.max(1, toMove);
        console.log(debug("moving " + toMove + " account(s) from " + highest.name + " to " + lowest.name));
        if (toMove >= 1) {
            Discord.postDiscordMessage("moving " + toMove + " account(s) from " + highest.name + " to " + lowest.name);
        }

        for (let i = 0; i < toMove; i++) {
            await Account.updateOne({
                enabled: true,
                requestServer: highest.name,
                errorCounter: {$lt: config.errorThreshold},
                accountType: AccountType.MICROSOFT
            }, {
                $set: {
                    requestServer: lowest.name,
                    lastRequestServer: highest.name
                }
            }).exec();
        }
    }

    private static async updateLoadBalancer(config: MineSkinConfig): Promise<void> {
        const accountsPerServer = await this.getAccountsPerServer(config);
        const requestServers = config.requestServers;
        const accountsPerOrigin: { [k: string]: number; } = {};
        // group by origin
        a: for (let k in accountsPerServer) {
            for (let rk in requestServers) {
                if (requestServers[rk].includes(k)) {
                    accountsPerOrigin[rk] = (accountsPerOrigin[rk] || 0) + accountsPerServer[k];
                    continue a;
                }
            }
            // didn't find a requestServer alias, default to just the server name
            accountsPerOrigin[k] = accountsPerServer[k];
        }
        console.log(accountsPerOrigin)
        let totalAccounts = 0;
        for (let k in accountsPerOrigin) {
            totalAccounts += accountsPerOrigin[k];
        }

        let weightChanges: { [k: string]: { old: number; new: number; } } = {};
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
                    if (!origin.enabled || !(origin.name in accountsPerOrigin)) continue;
                    let weight = Math.max(accountsPerOrigin[origin.name] / totalAccounts, 0.01);
                    let newOrigin: Origin = {
                        name: origin.name,
                        address: origin.address,
                        enabled: origin.enabled,
                        weight: this.max2Decimals(weight)
                    }
                    newOriginConfig.push(newOrigin);
                    if (Math.abs(newOrigin.weight - origin.weight) > 0.02) {
                        madeChanges = true;
                    }
                    weightChanges[origin.name] = {
                        old: origin.weight,
                        new: newOrigin.weight
                    };
                }

                if (madeChanges && newOriginConfig.length === currentOriginConfig.length) {
                    console.log(JSON.stringify(newOriginConfig));
                    const updateResponse = await this.patchPoolOrigins(config, poolId, newOriginConfig);
                    console.log(updateResponse);
                    if (!updateResponse.success) {
                        console.warn(warn("failed to update pool config for " + poolId));
                        console.warn(updateResponse);
                        continue;
                    }
                }
            } catch (e) {
                console.warn(warn("exception while updating pool config for " + poolId));
                if ("response" in e) {
                    console.warn(e.response);
                    if ("data" in e.response) {
                        console.warn(JSON.stringify(e.response.data));
                    }
                }
                continue;
            }
        }
        if (Object.keys(weightChanges).length > 0) {
            console.log(debug("Updated Cloudflare load balancer pools! New weights:"))
            for (let c in weightChanges) {
                console.log(debug(`${ c } ${ weightChanges[c].old } -> ${ weightChanges[c].new }`))
            }
        }
    }

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
                    console.info(`Restoring ${ origin.name } after maintenance`);
                    let newOrigin: Origin = {
                        ...origin,
                        weight: parseFloat(preMaintenanceWeight)
                    }
                    newOriginConfig.push(newOrigin);
                    if (newOrigin.weight !== origin.weight) {
                        madeChanges = true;
                    }
                }

                if (madeChanges && newOriginConfig.length === currentOriginConfig.length) {
                    console.log(JSON.stringify(newOriginConfig));
                    const updateResponse = await this.patchPoolOrigins(config, poolId, newOriginConfig);
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

    private static async getAccountsPerServer(config: MineSkinConfig): Promise<{ [k: string]: number }> {
        const res: { _id: number; count: number; }[] = await Account.aggregate([
            {
                $match: {
                    enabled: true,
                    errorCounter: {$lt: config.errorThreshold},
                    // $and: [
                    //     { lastSelected: { $ne: 0 } },
                    //     { lastSelected: { $gt: (Date.now() / 1000) - (60 * 60) } }
                    // ]
                }
            },
            {$group: {_id: '$requestServer', count: {$sum: 1}}}
        ]).exec();
        console.log(res)
        const out: { [k: string]: number } = {};
        for (let r of res) {
            out[r._id] = r.count
        }
        return out;
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

    // https://stackoverflow.com/a/11832950
    private static max2Decimals(n: number): number {
        return Math.round((n + Number.EPSILON) * 100) / 100
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
