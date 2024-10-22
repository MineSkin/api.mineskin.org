import winston, { format } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as Sentry from "@sentry/node";

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