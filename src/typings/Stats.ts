export interface Stats extends AccountStats, DurationStats, TimeFrameStats {
    server: string;

    delay: number;


    successRate?: number;
    mineskinTesterSuccessRate?: number;

    genUpload?: number;
    genUrl?: number;
    genUser?: number;

    unique?: number;
    duplicate?: number;
    total?: number;
    views?: number;
}

export interface AccountStats {
    accounts?: number;
    serverAccounts?: number;
    healthyAccounts?: number;
    useableAccounts?: number;
    accountTypes?: { [type: string]: number; };
}

export interface DurationStats {
    avgGenerateDuration?: number;
}

export interface SuccessRateStats {
    generateSuccess: number;
    generateFail: number;

    testerSuccess: number;
    testerFail: number;
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

    unique?: number;
    duplicate?: number;
    views?: number;
}

export interface TimeFrameStats {
    lastYear?: number;
    lastMonth?: number;
    lastDay?: number;
    lastHour?: number;
}
