import { SimplifiedUserAgent } from "../../util";
import { IApiKeyDocument, IUserDocument, User } from "@mineskin/database";
import { ClientInfo, Maybe, UUID } from "@mineskin/types";
import * as Sentry from "@sentry/node";
import { setUser } from "@sentry/node";
import { MineSkinV2Request } from "../../routes/v2/types";

export class RequestClient {

    readonly time: number;
    readonly userAgent: SimplifiedUserAgent;
    readonly origin: string | undefined;
    readonly ip: string;
    readonly via: string;

    userId: UUID | undefined;
    private _user: Promise<IUserDocument | undefined> | undefined;

    private apiKey: IApiKeyDocument | undefined;
    apiKeyRef: string | undefined;

    grants: Record<string, string | number | boolean> = {};

    constructor(
        time: number,
        userAgent: SimplifiedUserAgent,
        origin: string | undefined,
        ip: string,
        via: string
    ) {
        this.time = time;
        this.userAgent = userAgent;
        this.origin = origin;
        this.ip = ip;
        this.via = via;
    }

    setUserId(userId: UUID) {
        if (this.userId === userId) {
            return;
        }
        this.userId = userId;
        this._user = new Promise((resolve, reject) => {
            User.findByUUID(userId).then(u => {
                if (u) {
                    setUser(u);
                    resolve(u);
                } else {
                    resolve(undefined);
                }
            }).catch(e => {
                reject(e);
                Sentry.captureException(e);
            });
        });
    }

    setUser(user: IUserDocument) {
        this.userId = user.uuid;
        this._user = Promise.resolve(user);

        if (user.grants) {
            this.grants = {...this.grants, ...user.grants};
        }
    }

    async getUser(): Promise<Maybe<IUserDocument>> {
        if (!this._user) {
            return undefined;
        }
        return await this._user;
    }

    hasUser(): boolean {
        return !!this.userId;
    }

    setApiKey(apiKey: IApiKeyDocument) {
        this.apiKey = apiKey;
        this.apiKeyRef = `${ apiKey.id?.substring(0, 8) } ${ apiKey.name }`;

        if (apiKey.user) {
            this.setUserId(apiKey.user);
        }

        if (apiKey.grants) {
            this.grants = {...this.grants, ...apiKey.grants};
        }
    }

    getApiKey(): Maybe<IApiKeyDocument> {
        return this.apiKey;
    }

    isMetered(): boolean {
        return this.apiKey?.metered || false;
    }

    canUseCredits(): boolean {
        return !!this.userId;
    }

    usePaidCredits(): boolean {
        return this.apiKey?.useCredits || false;
    }

    isBillable(): boolean {
        return this.isMetered() || this.usePaidCredits();
    }

    asClientInfo(req: MineSkinV2Request): ClientInfo {
        if (req.clientInfo) {
            return req.clientInfo;
        }
        return {
            time: this.time,
            key: this.apiKey?.id,
            agent: this.userAgent.ua,
            origin: this.origin,
            ip: this.ip,
            breadcrumb: req.breadcrumb || '00000000',
            user: this.userId,

            billable: this.isBillable(),
            metered: this.isMetered(),
            credits: this.usePaidCredits()
        };
    }

}