import { Options as GitPullerOptions } from "express-git-puller";
import { ISingleHostConfig } from "influx";
import { Config as SshTunnelConfig } from "tunnel-ssh";
import { Options as EmailOptions } from "nodemailer/lib/smtp-transport";
import { Email } from "../util/Email";
import { GitConfig } from "@inventivetalent/gitconfig";

interface OptimusConfig {
    prime: number;
    inverse: number;
    random: number;
}

interface MongoConfig {
    useTunnel: boolean;
    tunnel: SshTunnelConfig;

    url?: string;
    user?: string;
    pass?: string;
    address?: string;
    port?: number;
    database: string;
}

interface CryptoConfig {
    algorithm: string;
    key: string;
}

interface EmailConfig extends EmailOptions {
}

interface DiscordConfig {
    token: string;
    channel?: string;
    guild?: string;
    role?: string;
    oauth?: DiscordOAUthConfig;
}

interface DiscordOAUthConfig {
    id: string;
    secret: string;
}

interface PullerConfig extends GitPullerOptions {
    endpoint: string;
}

interface SentryConfig {
    dsn: string;
}

interface MetricsConfig extends ISingleHostConfig {
}

interface GitConfigConfig {
    base: string;
    local: string;
    file: string;
    endpoint: string;
    secret: string;
    token: string;
}

export interface MineSkinConfig {
    port: number;
    server: string;
    master: boolean;

    generateDelay: number;
    errorThreshold: number;
    genSaveDelay: number;
    testerToken: string;
    sessionSecret: string;

    optimus: OptimusConfig;
    mongo: MongoConfig;
    crypto: CryptoConfig;
    email: EmailConfig;
    discord: DiscordConfig;
    discordAccount: DiscordOAUthConfig;
    discordApiKey: DiscordOAUthConfig;
    puller: PullerConfig;
    sentry: SentryConfig;
    metrics: MetricsConfig;
    gitconfig: GitConfigConfig;
}

export function getLocalConfig(): MineSkinConfig {
    return require("../../config.js") as MineSkinConfig;
}

export async function getConfig(): Promise<MineSkinConfig> {
    const local = getLocalConfig();
    const remote = await GitConfig.get("mineskin.config.json");
    return remote.mergedWith(local) as MineSkinConfig;
}
