import { Config } from "../types/Config";
import { Requests } from "../generator/Requests";
import * as Sentry from "@sentry/node";
import { IAccountDocument } from "../types";

const config: Config = require("../config");

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
        })
    }


    static notifyMissingCredentials(account: IAccountDocument): void {
        if (account.discordMessageSent) return;
        this.postDiscordMessage("⚠️ Account #" + account.id + " just lost its access token\n" +
            "  Current Server: " + account.lastRequestServer + "/" + account.requestServer + "\n" +
            "  Account Type: " + (account.microsoftAccount ? "microsoft" : "mojang") + "\n" +
            "  Total Success/Error: " + account.totalSuccessCounter + "/" + account.totalErrorCounter + "\n" +
            "  Account Added: " + new Date((account.timeAdded || 0) * 1000).toUTCString() + "\n" +
            "  Linked to <@" + account.discordUser + ">");

        if (account.discordUser) {
            this.sendDiscordDirectMessage("Hi there!\n" +
                "This is an automated notification that a MineSkin lost access to an account you linked to your Discord profile and has been disabled\n" +
                "  Affected Account: " + (account.playername || account.uuid) + " (" + account.username.substr(0, 4) + "****)\n" +
                "  Account Type: " + (account.microsoftAccount ? "microsoft" : "mojang") + "\n" +
                "  Last Error Code:  " + account.lastErrorCode + "\n" +
                "\n" +
                "The account won't be used for skin generation until the issues are resolved.\n" +
                "Please log back in to your account at https://mineskin.org/account\n" +
                "For further assistance feel free to ask in <#482181024445497354> 🙂", account.discordUser,
                () => {
                    this.postDiscordMessage("Hey <@" + account.discordUser + ">! I tried to send a private message but couldn't reach you :(\n" +
                        "MineSkin just lost access to one of your accounts (" + (account.microsoftAccount ? "microsoft" : "mojang") + ")\n" +
                        "  Account UUID (trimmed): " + (account.uuid || account.playername).substr(0, 5) + "****\n" +
                        "  Please log back in at https://mineskin.org/account\n", "636632020985839619");
                });
        }
        account.discordMessageSent = true;
        account.save();
    }

}
