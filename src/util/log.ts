import winston, { format } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { Log } from '@mineskin/generator';
import * as Sentry from "@sentry/node";
import * as nodeUtil from "node:util";

export function initApiLogger() {
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
        console.info(`Rotated log file from ${ oldFilename } to ${ newFilename }`);
    });

    const transform: winston.Logform.TransformFunction = (info) => {
        const args = info[Symbol.for('splat')];
        const {message: rawMessage} = info;
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

    const logger = winston.createLogger({
        level: 'http',
        format: format.combine(
            format.timestamp({format: 'YYYY-MM-DD HH:mm:ss.SSS'}),
            format.errors({stack: true}),
            utilFormatter(),
            format.colorize(),
            format.printf(
                ({level, message, timestamp, label}) =>
                    `${ timestamp } ${ label || '-' } ${ level }: ${ message }`,
            ),
        ),
        transports: [
            logRotate,
            new winston.transports.Console({
                level: 'debug',
            })
        ],
    });


    Log.init(logger);


    (() => {
        console.log = (...args: any[]) => {
            Log.l.info(args.join(' '));
        }
        console.error = (...args: any[]) => {
            Log.l.error(args.join(' '));
        }
        console.debug = (...args: any[]) => {
            Log.l.debug(args.join(' '));
        }
        console.info = (...args: any[]) => {
            Log.l.info(args.join(' '));
        }
        console.warn = (...args: any[]) => {
            Log.l.warn(args.join(' '));
        }

    })();
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
    console.info(`Rotated log file from ${ oldFilename } to ${ newFilename }`);
});

export const httpLogger = winston.createLogger({
    level: 'http',
    format: format.combine(
        format.timestamp({format: 'YYYY-MM-DD HH:mm:ss.SSS'}),
        format.printf(
            ({level, message, timestamp, label}) =>
                `${ timestamp } ${ label || '-' } ${ level }: ${ message }`,
        ),
    ),
    transports: [
        httpLogRotate,
        new winston.transports.Console({
            level: 'debug',
        })
    ],
});