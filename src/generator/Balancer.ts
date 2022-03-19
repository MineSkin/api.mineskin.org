import { getConfig, MineSkinConfig } from "../typings/Configs";
import { Requests } from "./Requests";
import { Account } from "../database/schemas";
import { debug, info, warn } from "../util/colors";

export class Balancer {

    static async balance(): Promise<void> {
        console.log(info("Balancing servers..."));
        const config: MineSkinConfig = await getConfig();
        //TODO: move accounts
        await this.updateLoadBalancer(config);
    }

    private static async updateLoadBalancer(config: MineSkinConfig): Promise<void> {
        const accountsPerServer = await this.getAccountsPerServer();
        let totalAccounts = 0;
        for (let k in accountsPerServer) {
            totalAccounts += accountsPerServer[k];
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
                    if (!origin.enabled || !(origin.name in accountsPerServer)) continue;
                    let newOrigin: Origin = {
                        name: origin.name,
                        address: origin.address,
                        enabled: origin.enabled,
                        weight: this.max2Decimals(accountsPerServer[origin.name] / totalAccounts)
                    }
                    newOriginConfig.push(newOrigin);
                    if (Math.abs(newOrigin.weight - origin.weight) > 0.02) {
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
                }
            } catch (e) {
                console.warn(warn("exception while updating pool config for " + poolId));
                if ("response" in e) {
                    console.warn(e.response);
                    if("data" in e.response) {
                        console.warn(JSON.stringify(e.response.data));
                    }
                }
                continue;
            }
        }
        console.log(debug("Updated Cloudflare load balancer pools!"))
    }

    private static async getAccountsPerServer(): Promise<{ [k: string]: number }> {
        const res: { _id: number; count: number; }[] = await Account.aggregate([
            {
                $match: {
                    enabled: true,
                    errorCounter: { $lt: 10 },
                    $and: [
                        { lastSelected: { $ne: 0 } },
                        { lastSelected: { $gt: (Date.now() / 1000) - (60 * 60) } }
                    ]
                }
            },
            { $group: { _id: '$requestServer', count: { $sum: 1 } } }
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
