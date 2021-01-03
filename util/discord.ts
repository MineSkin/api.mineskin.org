import { Config } from "../types/Config";
import { Requests } from "../generator/Requests";
import * as Sentry from "@sentry/node";

const config: Config = require("../config");

export function postDiscordMessage(content: string, channel?: string, fallback?: () => void): void {
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

export function sendDiscordDirectMessage(content: string, receiver: string, fallback?: () => void): void {
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
            postDiscordMessage(content, response.data.id, fallback);
        }
    })
}
