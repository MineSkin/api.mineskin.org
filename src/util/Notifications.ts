import * as Sentry from "@sentry/node";
import { IAccountDocument, MineSkinError } from "../typings";
import { AccountType } from "../typings/IAccountDocument";
import { GenerateType } from "../typings/ISkinDocument";
import { Discord, OWNER_CHANNEL, SUPPORT_CHANNEL } from "./Discord";
import { Email } from "./Email";

export class Notifications {

    protected static sendEmailAndDiscordMessage(account: IAccountDocument, message: (email: boolean) => string, publicMessage?: () => string) {
        if (account.discordUser && !account.discordMessageSent) {
            try {
                Discord.sendDiscordDirectMessage(message(false), account.discordUser, () => {
                    if (publicMessage) {
                        Discord.postDiscordMessage(publicMessage(), OWNER_CHANNEL);
                    }
                });

                account.discordMessageSent = true;
            } catch (e) {
                Sentry.captureException(e);
            }
        }
        if (account.sendEmails && account.email && !account.emailSent) {
            try {
                Email.sendEmail(account.email, message(true));

                account.emailSent = true;
            } catch (e) {
                Sentry.captureException(e);
            }
        }
    }

    protected static supportLink(email: boolean): string {
        return "For further assistance feel free to ask " + (email ? "on https://yeleha.co/discord" : "in <#" + SUPPORT_CHANNEL + ">") + " 🙂"
    }

    static notifyMissingCredentials(account: IAccountDocument): void {
        // Log Channel
        Discord.postDiscordMessage("⚠️ Account #" + account.id + " just lost its access token\n" +
            "  Current Server: " + account.lastRequestServer + "/" + account.requestServer + "\n" +
            "  Account Type: " + account.getAccountType() + "\n" +
            "  Total Success/Error: " + account.totalSuccessCounter + "/" + account.totalErrorCounter + "\n" +
            "  Account Added: " + new Date((account.timeAdded || 0) * 1000).toUTCString() + "\n" +
            "  Linked to <@" + account.discordUser + ">");

        this.sendEmailAndDiscordMessage(account,
            email => {
                return "This is an automated notification that MineSkin lost access to one of your accounts and has been disabled\n" +
                    "  Affected Account: " + (account.playername || account.uuid) + " (" + account.getEmail() + ")\n" +
                    "  Account Type: " + account.getAccountType() + "\n" +
                    "\n" +
                    "The account won't be used for skin generation until the issues are resolved.\n" +
                    "Please log back in to your account at https://mineskin.org/account\n" +
                    this.supportLink(email);
            },
            () => {
                return "Hey <@" + account.discordUser + ">! I tried to send a private message but couldn't reach you :(\n" +
                    "MineSkin just lost access to one of your accounts (" + account.getAccountType() + ")\n" +
                    "  Account UUID (trimmed): " + (account.uuid || account.playername || "").substr(0, 5) + "****\n" +
                    "  Please log back in at https://mineskin.org/account\n"
            })
    }

    static notifyLoginFailed(account: IAccountDocument, err: MineSkinError): void {
        // Log channel
        Discord.postDiscordMessage("⚠️ Account #" + account.id + " failed to login\n" +
            "  Error: " + err.msg + "\n" +
            "  Current Server: " + account.lastRequestServer + "/" + account.requestServer + "\n" +
            "  Account Type: " + account.getAccountType() + "\n" +
            "  Total Success/Error: " + account.totalSuccessCounter + "/" + account.totalErrorCounter + "\n" +
            "  Account Added: " + new Date((account.timeAdded || 0) * 1000).toUTCString() + "\n" +
            "  Linked to <@" + account.discordUser + ">");

        this.sendEmailAndDiscordMessage(account,
            email => {
                return "Hi there!\n" +
                    "This is an automated notification that MineSkin just failed to login to your account\n" +
                    "  Affected Account: " + (account.playername || account.uuid) + " (" + account.getEmail() + ")\n" +
                    "  Account Type: " + account.getAccountType() + "\n" +
                    "\n" +
                    "The account won't be used for skin generation until the issues are resolved.\n" +
                    "Please try to login at https://www.minecraft.net/login and check if there are any issues with your account and then log back in to your account at https://mineskin.org/account\n" +
                    (account.getAccountType() === AccountType.MICROSOFT ? "You should also check https://account.live.com/Activity\n" : "") +
                    this.supportLink(email);
            },
            () => {
                return "Hey <@" + account.discordUser + ">! I tried to send a private message but couldn't reach you :(\n" +
                    "MineSkin just failed to login to one of your accounts (" + account.getAccountType() + ")\n" +
                    "  Account UUID (trimmed): " + (account.uuid || account.playername || "").substr(0, 5) + "****\n" +
                    "  Please check your account for issues and log back in at https://mineskin.org/account\n"
            })
    }


    static notifyHighErrorCount(account: IAccountDocument, lastType: GenerateType, err: any): void {
        // Log channel
        Discord.postDiscordMessage("⚠️ Account #" + account.id + " has " + account.errorCounter + " errors!\n" +
            "  Current Server: " + account.lastRequestServer + "/" + account.requestServer + "\n" +
            "  Account Type: " + account.getAccountType() + "\n" +
            "  Latest Type: " + lastType + "\n" +
            "  Latest Cause: " + (err.code || err.msg || "n/a") + "\n" +
            "  Total Success/Error: " + account.totalSuccessCounter + "/" + account.totalErrorCounter + "\n" +
            "  Account Added: " + new Date((account.timeAdded || 0) * 1000).toUTCString() + "\n" +
            "  Linked to <@" + account.discordUser + ">");

        this.sendEmailAndDiscordMessage(account,
            email => {
                return "Hi there!\n" +
                    "This is an automated notification that one of your MineSkin accounts been disabled since it failed to properly generate skin data recently.\n" +
                    "  Affected Account: " + (account.playername || account.uuid) + " (" + account.getEmail() + ")\n" +
                    "  Account Type: " + account.getAccountType() + "\n" +
                    "  Last Error Code:  " + account.lastErrorCode + "\n" +
                    "\n" +
                    "The account won't be used for skin generation until the issues are resolved.\n" +
                    "Please make sure the configured credentials & security questions are correct at https://mineskin.org/account\n" +
                    this.supportLink(email);
            },
            () => {
                return "Hey <@" + account.discordUser + ">! I tried to send a private message but couldn't reach you :(\n" +
                    "One of your accounts (" + account.getAccountType() + ") was just disabled since it failed to properly generate skin data recently.\n" +
                    "  Account UUID (trimmed): " + (account.uuid || account.playername || "").substr(0, 5) + "****\n" +
                    "  Please log back in at https://mineskin.org/account\n"
            })
    }

}
