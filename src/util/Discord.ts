import { Requests } from "../generator/Requests";
import * as Sentry from "@sentry/node";
import { getConfig } from "../typings/Configs";
import { IAccountDocument, MineSkinError } from "../typings";
import { GenerateType } from "../typings/db/ISkinDocument";
import { AccountType } from "../typings/db/IAccountDocument";

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



}
