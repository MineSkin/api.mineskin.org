import { IAuditLogger } from "@mineskin/billing/dist/IAuditLogger";
import { Log } from "@mineskin/generator";

export class ApiAuditLogger implements IAuditLogger {
    log(tag: string, message: string, data?: any): void {
        const msg = `[${ tag }] ${ message }`;
        Log.l.info(msg, data);
    }
    warn(tag: string, message: string, data?: any): void {
        const msg = `[${ tag }] ⚠️ ${ message }`;
        Log.l.warn(msg, data);
    }
    error(tag: string, message: string, data?: any): void {
        const msg = `[${ tag }] 🛑 ${ message }`;
        Log.l.error(msg, data);
    }

}
