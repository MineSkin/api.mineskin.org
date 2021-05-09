import { Options as GitPullerOptions } from "express-git-puller";
import { ISingleHostConfig } from "influx";
import { Config as SshTunnelConfig } from "tunnel-ssh";
import { Options as EmailOptions } from "nodemailer/lib/smtp-transport";
import { Email } from "../util/Email";

interface OptimusConfig {
    prime: number;
    inverse: number;
    random: number;
}

interface TunnelConfig extends SshTunnelConfig {
}

interface MongoConfig {
    useTunnel: boolean;
    tunnel: TunnelConfig;

    user: string;
    pass: string;
    address: string;
    port: number;
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
}

export function getConfig(): MineSkinConfig {
    return require("../../config.js") as MineSkinConfig;
}
