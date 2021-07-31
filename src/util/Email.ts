import { createTransport } from "nodemailer";
import * as Sentry from "@sentry/node";
import { getConfig } from "../typings/Configs";
import * as Mail from "nodemailer/lib/mailer";
import { warn } from "./colors";
import { Maybe } from "./index";

const FROM = "noreply@mineskin.org";

export class Email {

    static async sendEmail(to: string, content: string, htmlContent: Maybe<string> = undefined, subject: string = "MineSkin Notification"): Promise<void> {
        const config = await getConfig();
        const transport = createTransport(config.email);
        transport.verify().then(() => {
            const message: Mail.Options = {
                from: `MineSkin ${ FROM }`,
                to: to,
                subject: subject,
                text: content,
                priority: "high",
                encoding: "utf8",
                html: `
<!DOCTYPE html>
<html lang="en">
    <head>
        <title>${ subject }</title>
        <meta charset="utf-8">
    </head>
    <body>
        ${ htmlContent ? htmlContent : '<p>${content}</p>' }
                
        <div itemscope itemtype="http://schema.org/EmailMessage">
          <meta itemprop="description" content="View Details on MineSkin">
          <div itemprop="potentialAction" itemscope itemtype="http://schema.org/ViewAction">
            <link itemprop="target" href="https://mineskin.org/account">
            <meta itemprop="name" content="Login to Account">
          </div>
          <div itemprop="publisher" itemscope itemtype="http://schema.org/Organization">
            <meta itemprop="name" content="MineSkin">
            <link itemprop="url" href="https://mineskin.org/">
          </div>
        </div>
        
        <script type="application/ld+json">
{
  "@context": "http://schema.org",
  "@type": "EmailMessage",
  "potentialAction": {
    "@type": "ViewAction",
    "target": "https://mineskin.org/account",
    "name": "Login to Account"
  },
  "description": "View Details on MineSkin"
}
        </script>

    </body>
</html>
`
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
