import winston from 'winston';

import { Logtail } from "@logtail/node";
import { LogtailTransport } from "@logtail/winston";
import { resolveHostname } from "./index";

export const logtail = new Logtail(process.env.LOGTAIL_TOKEN!);

export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({format: 'YYYY-MM-DD hh:mm:ss.SSS A'}),
        winston.format.json()
    ),
    defaultMeta: {
        server: resolveHostname()
    },
    transports: [
        new winston.transports.File({filename: 'logs/error.log', level: 'error'}),
        new winston.transports.File({filename: 'logs/combined.log'}),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),
        new LogtailTransport(logtail)
    ],
});

(()=>{
    console.log = (...args: any[]) => {
        logger.info(args.join(' '));
    }
    console.error = (...args: any[]) => {
        logger.error(args.join(' '));
    }
    console.debug = (...args: any[]) => {
        logger.debug(args.join(' '));
    }
    console.info = (...args: any[]) => {
        logger.info(args.join(' '));
    }
    console.warn = (...args: any[]) => {
        logger.warn(args.join(' '));
    }

    // Ensure that all logs are sent to Logtail
    logtail.flush()
})();