// Shared by the RisuAI account import card and its full-screen view.
import { language } from "src/lang";
import { alertError } from "src/ts/alert";
import { RisuAccountImportError } from "src/ts/storage/nodeStorage";

export function accountErrorText(error: { message: string, code: string | null } | null | undefined): string {
    switch (error?.code) {
        case "ACCOUNT_LOGIN_FAILED": return language.risuAccountErrorLoginFailed;
        case "ACCOUNT_LOGIN_EXPIRED": return language.risuAccountNeedsLogin;
        case "ACCOUNT_IMPORT_INTERRUPTED": return language.risuAccountInterrupted;
        case "ACCOUNT_NO_DATA": return language.risuAccountErrorNoData;
        case "ACCOUNT_REQUEST_FAILED": return language.risuAccountErrorRequestFailed;
        case "ACCOUNT_DB_UNREADABLE": return language.risuAccountErrorUnreadable;
        case "ACCOUNT_RATE_LIMITED": return language.risuAccountErrorRateLimited;
        case "ACCOUNT_DISK_FULL": return language.risuAccountErrorDiskFull;
        case "ACCOUNT_MISMATCH": return language.risuAccountErrorMismatch;
        case "ACCOUNT_STAGED_UNREADABLE": return language.risuAccountErrorStagedUnreadable;
        default: return error?.message ?? "";
    }
}

export function showAccountError(error: unknown) {
    if (error instanceof RisuAccountImportError) {
        alertError(accountErrorText({ message: error.message, code: error.code }));
    } else {
        alertError(error instanceof Error ? error.message : String(error));
    }
}

export function formatDuration(seconds: number): string {
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    if (minutes < 60) return language.risuAccountMinutes(minutes);
    return language.risuAccountHours(Math.floor(minutes / 60), minutes % 60);
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
