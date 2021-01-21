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

export interface DurationStats {
    avgGenerateDuration: number;
}

export interface CountDuplicateViewStats {
    genUpload: number;
    genUrl: number;
    genUser: number;

    duplicateUpload: number;
    duplicateUrl: number;
    duplicateUser: number;

    viewsUpload: number;
    viewsUrl: number;
    viewsUser: number;
}

export interface TimeFrameStats {
    lastYear: number;
    lastMonth: number;
    lastDay: number;
    lastHour: number;
}
