import DailyRotateFile from "winston-daily-rotate-file";
import * as Sentry from "@sentry/node";
import winston, { format } from "winston";
import nodeUtil from "node:util";
import { injectable } from "inversify";
import { ILogProvider } from "@mineskin/core";

@injectable()
export class ApiLogProvider implements ILogProvider {

    _logger: winston.Logger;

    constructor() {
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


        this._logger = logger;


        (() => {
            console.log = (...args: any[]) => {
                this.l.info(args.join(' '));
            }
            console.error = (...args: any[]) => {
                this.l.error(args.join(' '));
            }
            console.debug = (...args: any[]) => {
                this.l.debug(args.join(' '));
            }
            console.info = (...args: any[]) => {
                this.l.info(args.join(' '));
            }
            console.warn = (...args: any[]) => {
                this.l.warn(args.join(' '));
            }

        })();
    }

    get l(): winston.Logger {
        return this._logger;
    }

    setLogger(logger: winston.Logger) {
        this._logger = logger;
    }


}