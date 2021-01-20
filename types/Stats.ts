export interface Stats {
    server: string;

    delay: number;

    accounts: number;
    serverAccounts: number;
    healthyAccounts: number;
    useableAccounts: number;

    successRate: number;
    mineskinTesterSuccessRate: number;
}
