import winston, { format } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { Logtail } from "@logtail/node";
import { LogtailTransport } from "@logtail/winston";
import { resolveHostname } from "./index";
import * as Sentry from "@sentry/node";
import * as util from "node:util";


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

const transform: winston.Logform.TransformFunction = (info) => {
    const args = info[Symbol.for('splat')];
    const { message: rawMessage } = info;
    // Combine all the args with util.format
    // also do a util.format of the rawMessage which handles JSON
    const message = args
        ? util.format(rawMessage, ...args)
        : util.format(rawMessage);
    return {
        ...info,
        message,
    };
};

const utilFormatter = format(transform);

export const logger = winston.createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp({format: 'YYYY-MM-DD HH:mm:ss.SSS'}),
        utilFormatter(),
        format.colorize(),
        format.printf(
            ({ level, message, timestamp, label }) =>
                `${timestamp} ${label || '-'} ${level}: ${message}`,
        ),
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
            // format: winston.format.combine(
            //     winston.format.colorize(),
            //     winston.format.splat(),
            //     winston.format.simple(),
            //     winston.format.errors({ stack: true }),
            // )
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