import * as Sentry from "@sentry/node";
import { IAccountDocument, MineSkinError } from "../typings";
import { AccountType } from "../typings/db/IAccountDocument";
import { GenerateType } from "../typings/db/ISkinDocument";
import { Discord, OWNER_CHANNEL, SUPPORT_CHANNEL } from "./Discord";
import { Email } from "./Email";
import { MineSkinMetrics } from "./metrics";

export class Notifications {

    protected static async sendEmailAndDiscord(account: IAccountDocument,
                                               simpleMessage: (account: IAccountDocument, email: boolean) => string,
                                               publicMessage: (account: IAccountDocument) => string,
                                               htmlMessage: (account: IAccountDocument) => string,
                                               subject: (account: IAccountDocument) => string) {
        if (account.discordUser && !account.discordMessageSent) {
            try {
                await Discord.sendDiscordDirectMessage(simpleMessage(account, false), account.discordUser, async () => {
                    if (publicMessage) {
                        await Discord.postDiscordMessage(publicMessage(account), OWNER_CHANNEL);

                        (await MineSkinMetrics.get()).accountNotifications
                            .tag('type', 'discord_public')
                            .tag('account', `${ account.id }`)
                            .tag('account_type', account.accountType || 'unknown')
                            .inc();
                    }
                });

                account.discordMessageSent = true;

                (await MineSkinMetrics.get()).accountNotifications
                    .tag('type', 'discord')
                    .tag('account', `${ account.id }`)
                    .tag('account_type', account.accountType || 'unknown')
                    .inc();
            } catch (e) {
                Sentry.captureException(e);
            }
        }
        if (account.sendEmails && account.email && !account.emailSent) {
            try {
                await Email.sendEmail(account.email, simpleMessage(account, true), htmlMessage(account), subject(account));

                account.emailSent = true;

                (await MineSkinMetrics.get()).accountNotifications
                    .tag('type', 'email')
                    .tag('account', `${ account.id }`)
                    .tag('account_type', account.accountType || 'unknown')
                    .inc();
            } catch (e) {
                Sentry.captureException(e);
            }
        }
    }

    protected static supportLink(email: boolean): string {
        return "For further assistance feel free to ask " + (email ? "on https://yeleha.co/discord" : "in <#" + SUPPORT_CHANNEL + ">") + " 🙂"
    }

    protected static accountInfo(acc: IAccountDocument, html: boolean): string {
        if (html) {
            return `
<p style="margin-left: 20px">Affected Account: ${ acc.playername || acc.uuid } (${ acc.getEmail() })</p>
<p style="margin-left: 20px">Account Type: ${ acc.getAccountType() }</p>
<p style="margin-left: 20px">Last Error Code: ${ acc.lastErrorCode }</p>
            `
        } else {
            return `
  Affected Account: ${ acc.playername || acc.uuid } (${ acc.getEmail() })
  Account Type: ${ acc.getAccountType() }
  Last Error Code: ${ acc.lastErrorCode }
            `
        }
    }

    protected static trimmedAccountInfo(acc: IAccountDocument): string {
        return "  Account (trimmed): " + (acc.playername || acc.uuid || "").substr(0, 4) + "\\*\\*\\*\\*\n";
    }

    protected static publicPrefix(acc: IAccountDocument): string {
        return `Hey <@${ acc.discordUser }>! I tried to send a private message but couldn't reach you :(\n`
    }

    static notifyMissingCredentials(account: IAccountDocument): void {
        // Log Channel
        Discord.postDiscordMessage("⚠️ 👤 Account #" + account.id + " just lost its access token\n" +
            "  Current Server: " + account.lastRequestServer + "/" + account.requestServer + "\n" +
            "  Account Type: " + account.getAccountType() + "\n" +
            "  Total Success/Error: " + account.totalSuccessCounter + "/" + account.totalErrorCounter + "\n" +
            "  Account Added: " + new Date((account.timeAdded || 0) * 1000).toUTCString() + "\n" +
            "  Linked to " + account.email + "/<@" + account.discordUser + ">");

        this.sendEmailAndDiscord(account,
            (acc, email) => `
Hi there!
This is an automated notification that MineSkin lost access to one of your accounts and has been disabled
${ this.accountInfo(acc, false) }

The account won't be used for skin generation until the issues are resolved.
Please log back in to your account at https://mineskin.org/account
${ account.getAccountType() === AccountType.MICROSOFT ? "You should also check https://account.live.com/Activity" : "" }
${ this.supportLink(email) }
            `,
            acc => `
${ this.publicPrefix(acc) }
MineSkin just lost access to one of your accounts (${ acc.getAccountType() })\n
${ this.trimmedAccountInfo(acc) }
Please log back in at https://mineskin.org/account\n
            `,
            acc => `
<p><b>Hi there!</b></p>
<p>This is an automated notification that MineSkin lost access to one of your accounts and has been disabled</p>
${ this.accountInfo(acc, true) }
<p></p>
<p>The account won't be used for skin generation until the issues are resolved.</p>
<p>Please log back in to your account at <a href="https://mineskin.org/account">mineskin.org/account</a></p>
${ account.getAccountType() === AccountType.MICROSOFT ? "<p>You should also check <a href='https://account.live.com/Activity'>account.live.com/Activity</a></p>" : "" }
<p>${ this.supportLink(true) }</p>
            `,
            acc => `MineSkin Notification ${ acc.playername || acc.uuid }`)
    }

    static notifyLoginFailed(account: IAccountDocument, err: MineSkinError): void {
        // Log channel
        Discord.postDiscordMessage("⚠️ 👤 Account #" + account.id + " failed to login\n" +
            "  UUID: " + account.uuid + "\n" +
            "  Error: " + err.msg + "\n" +
            "  Current Server: " + account.lastRequestServer + "/" + account.requestServer + "\n" +
            "  Account Type: " + account.getAccountType() + "\n" +
            "  Total Success/Error: " + account.totalSuccessCounter + "/" + account.totalErrorCounter + "\n" +
            "  Account Added: " + new Date((account.timeAdded || 0) * 1000).toUTCString() + "\n" +
            "  Linked to " + account.email + "/<@" + account.discordUser + ">");

        this.sendEmailAndDiscord(account,
            (acc, email) => `
Hi there!
This is an automated notification that MineSkin just failed to login to your account
${ this.accountInfo(acc, false) }

The account won't be used for skin generation until the issues are resolved
Please try to login at https://www.minecraft.net/login and check if there are any issues with your account and then log back in to your account at https://mineskin.org/account
${ account.getAccountType() === AccountType.MICROSOFT ? "You should also check https://account.live.com/Activity" : "" }
${ this.supportLink(email) }
            `,
            acc => `
${ this.publicPrefix(acc) }
MineSkin just failed to login to one of your accounts (${ acc.getAccountType() })\n
${ this.trimmedAccountInfo(acc) }
Please log back in at https://mineskin.org/account\n
            `,
            acc => `
<p><b>Hi there!</b></p>
<p>This is an automated notification that MineSkin just failed to login to your account</p>
${ this.accountInfo(acc, true) }
<p></p>
<p>The account won't be used for skin generation until the issues are resolved.</p>
<p>Please try to login at <a href="https://www.minecraft.net/login">minecraft.net</a> and check if there are any issues with your account and then log back in to your account at <a href="https://mineskin.org/account">mineskin.org/account</a></p>
${ account.getAccountType() === AccountType.MICROSOFT ? "<p>You should also check <a href='https://account.live.com/Activity'>account.live.com/Activity</a></p>" : "" }
<p>${ this.supportLink(true) }</p>
            `,
            acc => `MineSkin Notification ${ acc.playername || acc.uuid }`)
    }


    static notifyHighErrorCount(account: IAccountDocument, lastType: GenerateType, err: any): void {
        // Log channel
        Discord.postDiscordMessage("⚠️ 👤 Account #" + account.id + " has " + account.errorCounter + " errors!\n" +
            "  Current Server: " + account.lastRequestServer + "/" + account.requestServer + "\n" +
            "  Account Type: " + account.getAccountType() + "\n" +
            "  Latest Type: " + lastType + "\n" +
            "  Latest Cause: " + (err.code || err.msg || "n/a") + "\n" +
            "  Total Success/Error: " + account.totalSuccessCounter + "/" + account.totalErrorCounter + "\n" +
            "  Account Added: " + new Date((account.timeAdded || 0) * 1000).toUTCString() + "\n" +
            "  Linked to " + account.email + "/<@" + account.discordUser + ">");

        this.sendEmailAndDiscord(account,
            (acc, email) => `
Hi there!
This is an automated notification that one of your MineSkin accounts been disabled since it failed to properly generate skin data recently.
${ this.accountInfo(acc, false) }

The account won't be used for skin generation until the issues are resolved.
Please make sure the configured credentials & security questions are correct at https://mineskin.org/account
${ account.getAccountType() === AccountType.MICROSOFT ? "You should also check https://account.live.com/Activity" : "" }
${ this.supportLink(email) }
            `,
            acc => `
${ this.publicPrefix(acc) }
One of your accounts (${ acc.getAccountType() }) was just disabled since it failed to properly generate skin data recently. 
${ this.trimmedAccountInfo(acc) }
Please log back in at https://mineskin.org/account
            `,
            acc => `
<p><b>Hi there!</b></p>
<p>This is an automated notification that one of your MineSkin accounts been disabled since it failed to properly generate skin data recently.</p>
${ this.accountInfo(acc, true) }
<p></p>
<p>The account won't be used for skin generation until the issues are resolved.</p>
<p>Please make sure the configured credentials & security questions are correct at  <a href="https://mineskin.org/account">mineskin.org/account</a></p>
${ account.getAccountType() === AccountType.MICROSOFT ? "<p>You should also check <a href='https://account.live.com/Activity'>account.live.com/Activity</a></p>" : "" }
<p>${ this.supportLink(true) }</p>
            `,
            acc => `MineSkin Notification ${ acc.playername || acc.uuid }`)
    }

}
