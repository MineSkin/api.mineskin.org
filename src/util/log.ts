import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { Logtail } from "@logtail/node";
import { LogtailTransport } from "@logtail/winston";
import { resolveHostname } from "./index";
import * as Sentry from "@sentry/node";


export const logtail = process.env.LOGTAIL_TOKEN ? new Logtail(process.env.LOGTAIL_TOKEN!) : null;

const logRotate: DailyRotateFile = new DailyRotateFile({
    level: 'debug',
    filename: 'logs/mineskin-%DATE%.log',
    datePattern: 'YYYY-MM-DD-HH',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d'
});

logRotate.on('error', error => {
    console.warn("logrotate failed", error);
    Sentry.captureException(error);
});

logRotate.on('rotate', (oldFilename, newFilename) => {
    console.info(`Rotated log file from ${oldFilename} to ${newFilename}`);
});

export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.splat(),
        winston.format.timestamp({format: 'YYYY-MM-DD hh:mm:ss.SSS'}),
        winston.format.json()
    ),
    defaultMeta: {
        server: resolveHostname()
    },
    transports: [
        new winston.transports.File({filename: 'logs/error.log', level: 'error'}),
        // new winston.transports.File({filename: 'logs/combined.log'}),
        logRotate,
        new winston.transports.Console({
            level: 'debug',
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple(),
                winston.format.errors({ stack: true }),
            )
        })
    ],
});

if (logtail) {
    logger.add(new LogtailTransport(logtail,{
        level: 'info'
    }));
}


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
    logtail?.flush()
})();