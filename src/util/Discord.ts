import { Requests } from "../generator/Requests";
import * as Sentry from "@sentry/node";
import { getConfig } from "../typings/Configs";
import { IAccountDocument } from "../typings";
import { Request } from "express";
import { getIp } from "./index";

export const OWNER_CHANNEL = "636632020985839619";
export const SUPPORT_CHANNEL = "482181024445497354";

export class Discord {

    static async postDiscordMessage(content: string, channel?: string, fallback?: () => void): Promise<void> {
        const config = await getConfig();
        if (!config.discordAccount || !config.discord.token) return;
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

    static async postDiscordMessageWithAttachment(content: string, file: Buffer, fileName: string, channel?: string): Promise<void> {
        const config = await getConfig();
        if (!config.discordAccount || !config.discord.token) return;
        if (!channel) channel = config.discord.channel;
        const body = new FormData();
        body.append("content", content);
        body.append("file", new Blob([new Uint8Array(file)]), fileName);
        Requests.axiosInstance.request({
            method: "POST",
            url: "https://discordapp.com/api/channels/" + channel + "/messages",
            headers: {
                "Authorization": "Bot " + config.discord.token,
                "User-Agent": "MineSkin",
                "Content-Type": "multipart/form-data"
            },
            data: body
        }).then(response => {
            if (response.status !== 200) {
                console.warn("postDiscordMessageWithAttachment");
                console.warn(response.status);
                console.warn(response.data);
            }
        }).catch(err => {
            Sentry.captureException(err);
        })
    }


    static async sendDiscordDirectMessage(content: string, receiver: string, fallback?: () => void): Promise<void> {
        const config = await getConfig();
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
        const config = await getConfig();
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
        const config = await getConfig();
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

    static notifyNewAccount(account: IAccountDocument, req: Request): void {
        this.postDiscordMessage("ℹ 👤 A new Account #" + account.id + " has just been added!\n" +
            "  Account Type: " + account.getAccountType() + "\n" +
            "  UUID: " + account.uuid + "\n" +
            "  Server: " + account.requestServer + "\n" +
            "  Agent: " + req.headers["user-agent"] + "\n" +
            "  IP: " + getIp(req));
    }


}
