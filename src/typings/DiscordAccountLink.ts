export interface IPendingDiscordLink {
    state: string;
}

export interface PendingDiscordAccountLink extends IPendingDiscordLink{
    account?: number;
    uuid?: string;
    user?: string;
    email: string;
}

export interface PendingDiscordApiKeyLink extends IPendingDiscordLink {
    user?: string;
}
