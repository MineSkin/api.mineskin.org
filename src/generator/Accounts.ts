import { Maybe } from "@mineskin/types";
import { Account, IAccountDocument } from "@mineskin/database";
import { Bread } from "../typings/Bread";
import * as Sentry from "@sentry/node";
import { MineSkinMetrics } from "../util/metrics";
import { Generator } from "./Generator";
import { debug, error, warn } from "../util/colors";
import { Caching } from "./Caching";
import { Discord } from "../util/Discord";

export class Accounts {

    public static async findUsable(bread?: Bread): Promise<Maybe<IAccountDocument>> {
        return await Sentry.startSpan({
            op: "account_findUsable",
            name: "Account.findUsable"
        }, async span => {
            const time = Math.floor(Date.now() / 1000);
            const metrics = await MineSkinMetrics.get();
            const account = await Account.findOne(await Generator.usableAccountsQuery()).sort({
                lastUsed: 1,
                lastSelected: 1,
                sameTextureCounter: 1
            }).exec()
            if (!account) {
                console.warn(error(bread?.breadcrumb + " There are no accounts available!"));
                span?.setStatus({
                    code: 2,
                    message: "not_found"
                })
                return undefined;
            }
            if (Caching.isAccountLocked(account.id)) {
                console.warn(warn(bread?.breadcrumb + " Selecting a different account since " + account.id + " got locked since querying"));
                span?.setStatus({
                    code: 2,
                    message: "not_found"
                })
                return Accounts.findUsable(bread);
            }
            Caching.lockSelectedAccount(account.id, bread);

            let usedDiff = Math.round(time - (account.lastUsed || 0));
            let selectedDiff = Math.round(time - (account.lastSelected || 0));
            console.log(debug(bread?.breadcrumb + " Account #" + account.id + " last used " + usedDiff + "s ago, last selected " + selectedDiff + "s ago"));
            Sentry.setExtras({
                "used_diff": usedDiff,
                "selected_diff": selectedDiff
            });
            let usedDiffMins = Math.round(usedDiff / 60 / 2) * 2;
            Sentry.setTag("used_diff_mins", `${ usedDiffMins }`);
            try {
                metrics.metrics!.influx.writePoints([{
                    measurement: 'account_selection_difference',
                    tags: {
                        server: metrics.config.server,
                        account: account.id
                    },
                    fields: {
                        lastSelected: selectedDiff,
                        lastUsed: usedDiff
                    }
                }], {
                    database: 'mineskin',
                    precision: 'ms'
                })
            } catch (e) {
                Sentry.captureException(e);
            }

            account.lastSelected = time;
            if (!account.successCounter) account.successCounter = 0;
            if (!account.errorCounter) account.errorCounter = 0;
            if (!account.totalSuccessCounter) account.totalSuccessCounter = 0;
            if (!account.totalErrorCounter) account.totalErrorCounter = 0;

            return await account.save();
        })
    }

    public static async updateAccountRequestServer(account: IAccountDocument, newRequestServer: string | null, bread?: Bread): Promise<void> {
        if (account.requestServer && account.requestServer !== newRequestServer) {
            account.lastRequestServer = account.requestServer;
            Discord.postDiscordMessage("👤 Account " + account.id + "/" + account.uuid + " moved to " + account.requestServer + " (was " + account.lastRequestServer + ")");
        }
        account.requestServer = newRequestServer;
    }

    public static isAccountOnHiatus(account: IAccountDocument): boolean {
        const now = Math.floor(Date.now() / 1000);
        const fifteenMins = 900;
        return !!account.hiatus &&
            account.hiatus.enabled &&
            (now - account.hiatus.lastPing < fifteenMins || now - account.hiatus.lastLaunch < fifteenMins);
    }

}