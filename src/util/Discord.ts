import { Requests } from "../generator/Requests";
import * as Sentry from "@sentry/node";
import { getConfig } from "../typings/Configs";
import { IAccountDocument, MineSkinError } from "../typings";
import { GenerateType } from "../typings/ISkinDocument";
import { AccountType } from "../typings/IAccountDocument";

const config = getConfig();

export const OWNER_CHANNEL = "636632020985839619";
export const SUPPORT_CHANNEL = "482181024445497354";

export class Discord {

    static postDiscordMessage(content: string, channel?: string, fallback?: () => void): void {
        if (!config.discord || !config.discord.token) return;
        if (!channel) channel = config.discord.channel;
        Requests.axiosInstance.request({
            method: "POST",
            url: "https://discordapp.com/api/channels/" + channel + "/messages",
            headers: {
                "Authorization": "Bot " + config.discord.token,
                "User-Agent": "MineSkin",
                "Content-Type": "application/json"
            },
            data: JSON.stringify({ content: content })
        }).then(response => {
            if (response.status !== 200) {
                console.warn("postDiscordMessage");
                console.warn(response.status);
                console.warn(response.data);
                if (fallback) {
                    fallback();
                }
            }
        }).catch(err => {
            Sentry.captureException(err);
        })
    }


    static sendDiscordDirectMessage(content: string, receiver: string, fallback?: () => void): void {
        if (!config.discord || !config.discord.token) return;
        Requests.axiosInstance.request({
            method: "POST",
            url: "https://discordapp.com/api/users/@me/channels",
            headers: {
                "Authorization": "Bot " + config.discord.token,
                "User-Agent": "MineSkin",
                "Content-Type": "application/json"
            },
            data: JSON.stringify({ recipient_id: receiver })
        }).then(response => {
            if (response.status !== 200) {
                console.warn("sendDiscordDirectMessage")
                console.warn(response.status);
                console.warn(response.data);
                if (fallback) {
                    fallback();
                }
            } else {
                this.postDiscordMessage(content, response.data.id, fallback);
            }
        }).catch(err => {
            Sentry.captureException(err);
        })
    }

    static async addDiscordAccountOwnerRole(userId: string): Promise<boolean> {
        if (!config.discord || !config.discord.token || !config.discord.guild) return false;
        return Requests.axiosInstance.request({
            method: "PUT",
            url: "https://discordapp.com/api/guilds/" + config.discord.guild + "/members/" + userId + "/roles/" + config.discord.role,
            headers: {
                "Authorization": "Bot " + config.discord.token
            }
        }).then(response => {
            if (response.status !== 200) {
                console.warn("addDiscordAccountOwnerRole")
                console.warn(response.status);
                console.warn(response.data);
                return false;
            } else {
                console.log("Added Mineskin role to discord user #" + userId);
                return true;
            }
        }).catch(err => {
            Sentry.captureException(err);
            return false;
        })
    }

    static async removeDiscordAccountOwnerRole(userId: string): Promise<boolean> {
        if (!config.discord || !config.discord.token || !config.discord.guild) return false;
        return Requests.axiosInstance.request({
            method: "DELETE",
            url: "https://discordapp.com/api/guilds/" + config.discord.guild + "/members/" + userId + "/roles/" + config.discord.role,
            headers: {
                "Authorization": "Bot " + config.discord.token
            }
        }).then(response => {
            if (response.status !== 200) {
                console.warn("addDiscordAccountOwnerRole")
                console.warn(response.status);
                console.warn(response.data);
                return false;
            } else {
                console.log("Removed Mineskin role from discord user #" + userId);
                return true;
            }
        }).catch(err => {
            Sentry.captureException(err);
            return false;
        })
    }

    static notifyNewAccount(account: IAccountDocument): void {
        this.postDiscordMessage("ℹ A new Account #" + account.id + " has just been added!\n" +
            "  Account Type: " + account.getAccountType() + "\n" +
            "  Server: " + account.requestServer);
    }

    static notifyMissingCredentials(account: IAccountDocument): void {
        this.postDiscordMessage("⚠️ Account #" + account.id + " just lost its access token\n" +
            "  Current Server: " + account.lastRequestServer + "/" + account.requestServer + "\n" +
            "  Account Type: " + account.getAccountType() + "\n" +
            "  Total Success/Error: " + account.totalSuccessCounter + "/" + account.totalErrorCounter + "\n" +
            "  Account Added: " + new Date((account.timeAdded || 0) * 1000).toUTCString() + "\n" +
            "  Linked to <@" + account.discordUser + ">");

        if (account.discordMessageSent) return;
        if (account.discordUser) {
            this.sendDiscordDirectMessage("Hi there!\n" +
                "This is an automated notification that a MineSkin lost access to an account you linked to your Discord profile and has been disabled\n" +
                "  Affected Account: " + (account.playername || account.uuid) + " (" + account.getEmail() + ")\n" +
                "  Account Type: " + account.getAccountType() + "\n" +
                "\n" +
                "The account won't be used for skin generation until the issues are resolved.\n" +
                "Please log back in to your account at https://mineskin.org/account\n" +
                "For further assistance feel free to ask in <#" + SUPPORT_CHANNEL + "> 🙂", account.discordUser,
                () => {
                    this.postDiscordMessage("Hey <@" + account.discordUser + ">! I tried to send a private message but couldn't reach you :(\n" +
                        "MineSkin just lost access to one of your accounts (" + account.getAccountType() + ")\n" +
                        "  Account UUID (trimmed): " + (account.uuid || account.playername || "").substr(0, 5) + "****\n" +
                        "  Please log back in at https://mineskin.org/account\n", OWNER_CHANNEL);
                });
            account.discordMessageSent = true;
            account.save();
        }
    }

    static notifyLoginFailed(account: IAccountDocument, err: MineSkinError): void {
        this.postDiscordMessage("⚠️ Account #" + account.id + " failed to login\n" +
            "  Error: " + err.msg + "\n" +
            "  Current Server: " + account.lastRequestServer + "/" + account.requestServer + "\n" +
            "  Account Type: " + account.getAccountType() + "\n" +
            "  Total Success/Error: " + account.totalSuccessCounter + "/" + account.totalErrorCounter + "\n" +
            "  Account Added: " + new Date((account.timeAdded || 0) * 1000).toUTCString() + "\n" +
            "  Linked to <@" + account.discordUser + ">");

        if (account.discordMessageSent) return;
        if (account.discordUser) {
            this.sendDiscordDirectMessage("Hi there!\n" +
                "This is an automated notification that a MineSkin just failed to login to your account\n" +
                "  Affected Account: " + (account.playername || account.uuid) + " (" + account.getEmail() + ")\n" +
                "  Account Type: " + account.getAccountType() + "\n" +
                "\n" +
                "The account won't be used for skin generation until the issues are resolved.\n" +
                "Please try to login at https://www.minecraft.net/login and check if there are any issues with your account and then log back in to your account at https://mineskin.org/account\n" +
                (account.getAccountType() === AccountType.MICROSOFT ? "You should also check https://account.live.com/Activity\n" : "") +
                "For further assistance feel free to ask in <#" + SUPPORT_CHANNEL + "> 🙂", account.discordUser,
                () => {
                    this.postDiscordMessage("Hey <@" + account.discordUser + ">! I tried to send a private message but couldn't reach you :(\n" +
                        "MineSkin just failed to login to one of your accounts (" + account.getAccountType() + ")\n" +
                        "  Account UUID (trimmed): " + (account.uuid || account.playername || "").substr(0, 5) + "****\n" +
                        "  Please check your account for issues and log back in at https://mineskin.org/account\n", OWNER_CHANNEL);
                });
            account.discordMessageSent = true;
            account.save();
        }
    }


    static notifyHighErrorCount(account: IAccountDocument, lastType: GenerateType, err: any): void {
        this.postDiscordMessage("⚠️ Account #" + account.id + " has " + account.errorCounter + " errors!\n" +
            "  Current Server: " + account.lastRequestServer + "/" + account.requestServer + "\n" +
            "  Account Type: " + account.getAccountType() + "\n" +
            "  Latest Type: " + lastType + "\n" +
            "  Latest Cause: " + (err.code || err.msg || "n/a") + "\n" +
            "  Total Success/Error: " + account.totalSuccessCounter + "/" + account.totalErrorCounter + "\n" +
            "  Account Added: " + new Date((account.timeAdded || 0) * 1000).toUTCString() + "\n" +
            "  Linked to <@" + account.discordUser + ">");

        if (account.discordMessageSent) return;
        if (account.discordUser) {
            Discord.sendDiscordDirectMessage("Hi there!\n" +
                "This is an automated notification that a MineSkin account you linked to your Discord profile has been disabled since it failed to properly generate skin data recently.\n" +
                "  Affected Account: " + (account.playername || account.uuid) + " (" + account.getEmail() + ")\n" +
                "  Account Type: " + account.getAccountType() + "\n" +
                "  Last Error Code:  " + account.lastErrorCode + "\n" +
                "\n" +
                "The account won't be used for skin generation until the issues are resolved.\n" +
                "Please make sure the configured credentials & security questions are correct at https://mineskin.org/account\n" +
                "For further assistance feel free to ask in <#" + SUPPORT_CHANNEL + "> 🙂", account.discordUser,
                function () {
                    Discord.postDiscordMessage("Hey <@" + account.discordUser + ">! I tried to send a private message but couldn't reach you :(\n" +
                        "One of your accounts (" + account.getAccountType() + ") was just disabled since it failed to properly generate skin data recently.\n" +
                        "  Account UUID (trimmed): " + (account.uuid || account.playername || "").substr(0, 5) + "****\n" +
                        "  Please log back in at https://mineskin.org/account\n", OWNER_CHANNEL);
                });
            account.discordMessageSent = true;
            // account.save(); - should be saved by the caller
        }
    }

}
