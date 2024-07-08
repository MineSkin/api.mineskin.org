import chalk, { Chalk } from "chalk";

export interface Bread {
    breadcrumb?: string;
    breadcrumbId?: string;
}

export const BREAD_COLORS: Chalk[] = [
    chalk.magenta,
    chalk.cyan,
    chalk.redBright,
    chalk.greenBright,
    chalk.blueBright,
    chalk.magentaBright,
    chalk.cyanBright,
    chalk.yellowBright
]
let colorCounter = 0;

export function nextBreadColor(): Chalk {
    if (colorCounter >= BREAD_COLORS.length) {
        colorCounter = 0;
    }
    return BREAD_COLORS[colorCounter++];
}
