import winston from "winston";
import { ILogProvider, TYPES as CoreTypes } from "@mineskin/core";
import { container } from "./inversify.config";

export class Log {

    static _logger: winston.Logger;

    static get l() {
        if (this._logger) {
            return this._logger;
        }
        this._logger = container.get<ILogProvider>(CoreTypes.LogProvider).l;
        return this._logger;
    }
}
