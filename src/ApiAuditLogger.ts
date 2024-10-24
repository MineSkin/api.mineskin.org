import { inject, injectable } from "inversify";
import { IAuditLogger, ILogProvider, TYPES as CoreTypes } from "@mineskin/core";
import winston from "winston";

@injectable()
export class ApiAuditLogger implements IAuditLogger {

    readonly logger: winston.Logger;

    constructor(
        @inject(CoreTypes.LogProvider) logProvider: ILogProvider
    ) {
        this.logger = logProvider.l.child({label: "Audit"})
    }

    log(tag: string, message: string, data?: any): void {
        const msg = `[${ tag }] ${ message }`;
        this.logger.info(msg, data);
    }
    warn(tag: string, message: string, data?: any): void {
        const msg = `[${ tag }] ⚠️ ${ message }`;
        this.logger.warn(msg, data);
    }
    error(tag: string, message: string, data?: any): void {
        const msg = `[${ tag }] 🛑 ${ message }`;
        this.logger.error(msg, data);
    }

}
