import { Options as GitPullerOptions } from "express-git-puller";
import { ISingleHostConfig } from "influx";
import { Config as SshTunnelConfig } from "tunnel-ssh";

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

interface DiscordConfig {
    token: string;
    channel?: string;
    guild?: string;
    role?: string;
}

interface PullerConfig extends GitPullerOptions {
    endpoint: string;
}

interface SentryConfig {
    dsn: string;
}

interface MetricsConfig extends ISingleHostConfig {
}

export interface Config {
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
    discord: DiscordConfig;
    puller: PullerConfig;
    sentry: SentryConfig;
    metrics: MetricsConfig;
}
