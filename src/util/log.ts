import winston, { format } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { Logtail } from "@logtail/node";
import { LogtailTransport } from "@logtail/winston";
import * as Sentry from "@sentry/node";
import * as nodeUtil from "node:util";


export const logtail = process.env.LOGTAIL_TOKEN ? new Logtail(process.env.LOGTAIL_TOKEN!) : null;

const logRotate: DailyRotateFile = new DailyRotateFile({
    level: 'debug',
    filename: 'logs/mineskin-%DATE%.log',
    datePattern: 'YYYY-MM-DD-HH',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '7d',
    createSymlink: true,
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
        ? nodeUtil.format(rawMessage, ...args)
        : nodeUtil.format(rawMessage);
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
        format.errors({ stack: true }),
        utilFormatter(),
        format.colorize(),
        format.printf(
            ({ level, message, timestamp, label }) =>
                `${timestamp} ${label || '-'} ${level}: ${message}`,
        ),
    ),
    transports: [
        logRotate,
        new winston.transports.Console({
            level: 'debug',
        })
    ],
});

if (logtail) {
    logger.add(new LogtailTransport(logtail,{
        level: 'info'
    }));
}


const httpLogRotate: DailyRotateFile = new DailyRotateFile({
    level: 'debug',
    filename: 'logs/mineskin-http-%DATE%.log',
    datePattern: 'YYYY-MM-DD-HH',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '7d',
    createSymlink: true,
    symlinkName: 'current-http.log'
});

httpLogRotate.on('error', error => {
    console.warn("logrotate failed", error);
    Sentry.captureException(error);
});

httpLogRotate.on('rotate', (oldFilename, newFilename) => {
    console.info(`Rotated log file from ${oldFilename} to ${newFilename}`);
});

export const httpLogger = winston.createLogger({
    level: 'http',
    format: format.combine(
        format.timestamp({format: 'YYYY-MM-DD HH:mm:ss.SSS'}),
        format.printf(
            ({ level, message, timestamp, label }) =>
                `${timestamp} ${label || '-'} ${level}: ${message}`,
        ),
    ),
    transports: [
        httpLogRotate,
        new winston.transports.Console({
            level: 'debug',
        })
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
    logtail?.flush()
})();