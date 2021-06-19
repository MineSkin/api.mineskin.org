import { createTransport } from "nodemailer";
import * as Sentry from "@sentry/node";
import { getConfig } from "../typings/Configs";
import * as Mail from "nodemailer/lib/mailer";
import { warn } from "./colors";

const FROM = "noreply@mineskin.org";

export class Email {

    static async sendEmail(to: string, content: string, subject: string = "MineSkin Notification"): Promise<void> {
        const config = await getConfig();
        const transport = createTransport(config.email);
        transport.verify().then(() => {
            const message: Mail.Options = {
                from: `MineSkin ${ FROM }`,
                to: to,
                subject: subject,
                text: content
            }
            transport.sendMail(message).catch(err => {
                console.warn(warn(err))
                Sentry.captureException(err);
            })
        }).catch(err => {
            console.warn(warn(err))
            Sentry.captureException(err);
        })
    }

}
