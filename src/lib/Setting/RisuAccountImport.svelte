<script lang="ts">
    // RisuAI account import on the data migration page: the login, the plan
    // and the double confirmation. Once started, the import replaces the
    // whole app with RisuAccountImportScreen until it ends. The server does
    // the work (server/node/risu-account-import.cjs).
    import { onDestroy } from "svelte";
    import { language } from "src/lang";
    import ShButton from "src/lib/UI/GUI/ShButton.svelte";
    import ShAlert from "src/lib/UI/GUI/ShAlert.svelte";
    import { alertConfirmMulti, alertError, alertTOS } from "src/ts/alert";
    import { flushSaves, forageStorage } from "src/ts/globalApi.svelte";
    import type { RisuAccountImportStatus } from "src/ts/storage/nodeStorage";
    import { TriangleAlertIcon } from "@lucide/svelte";
    import RisuAccountLoginDialog from "./RisuAccountLoginDialog.svelte";
    import { accountErrorText, formatDuration, showAccountError } from "./risuAccountImportUi";

    const POLL_MS = 1500;
    // After a failed status read, whatever the last known state was.
    const RETRY_MS = 5000;

    let status = $state<RisuAccountImportStatus | null>(null);
    let loginOpen = $state(false);
    let busy = $state(false);
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshGeneration = 0;
    let destroyed = false;

    const importState = $derived(status?.state ?? "idle");
    const summary = $derived(importState === "ready" ? status?.summary ?? null : null);
    const progress = $derived(status?.progress ?? null);

    async function refresh() {
        const generation = ++refreshGeneration;
        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }
        let next: RisuAccountImportStatus | null = null;
        try {
            next = await forageStorage.getRisuAccountImportStatus();
        } catch (error) {
            console.warn("[AccountImport] status failed", error);
        }
        // A read started later (a button runs its own refresh) has the newer
        // answer and keeps the polling; this one may have come back after it.
        if (generation !== refreshGeneration || destroyed) return;
        if (next) {
            status = next;
            // Started from another device: reload into the import screen.
            if (next.blocking) {
                location.reload();
                return;
            }
        }
        if (!next) {
            pollTimer = setTimeout(refresh, RETRY_MS);
        } else if (next.state === "preparing") {
            pollTimer = setTimeout(refresh, POLL_MS);
        }
    }

    async function run(action: () => Promise<void>) {
        busy = true;
        try {
            await action();
        } catch (error) {
            showAccountError(error);
        } finally {
            busy = false;
        }
        await refresh();
    }

    async function login() {
        if (!(await alertTOS())) return;
        loginOpen = true;
    }

    function onLogin(token: string, id: string) {
        void run(() => forageStorage.prepareRisuAccountImport(token, id));
    }

    async function start() {
        if (!summary) return;
        const time = formatDuration(summary.estimatedSeconds);
        if (await alertConfirmMulti(language.risuAccountConfirm1Title, [language.risuAccountContinue], language.risuAccountConfirm1(time)) !== 0) return;
        if (await alertConfirmMulti(language.risuAccountConfirm2Title, [{ label: language.risuAccountConfirmStart, variant: "destructive" }], language.risuAccountConfirm2) !== 0) return;
        busy = true;
        try {
            // Edits not saved yet would be missing from the data kept when
            // the import is cancelled.
            if (!(await flushSaves())) {
                busy = false;
                alertError(language.risuAccountSaveFailed);
                return;
            }
            await forageStorage.startRisuAccountDownload();
        } catch (error) {
            busy = false;
            showAccountError(error);
            await refresh();
            return;
        }
        location.reload();
    }

    refresh();

    onDestroy(() => {
        destroyed = true;
        if (pollTimer) clearTimeout(pollTimer);
    });
</script>

<div class="py-3">
    <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col min-w-0">
            <span class="text-sm text-textcolor">{language.risuAccountImport}</span>
            <p class="text-xs text-textcolor2 mt-0.5">{language.risuAccountImportDesc}</p>
        </div>
        {#if importState === "idle"}
            <ShButton variant="outline" size="sm" className="shrink-0" disabled={busy} onclick={login}>{language.risuAccountLogin}</ShButton>
        {/if}
    </div>

    {#if importState === "idle" && status?.error}
        <div class="mt-3">
            <ShAlert variant="destructive">
                {#snippet icon()}<TriangleAlertIcon />{/snippet}
                {accountErrorText(status.error)}
            </ShAlert>
        </div>
    {/if}

    {#if importState === "preparing"}
        <div class="flex items-center justify-between gap-3 mt-3">
            <p class="text-sm text-textcolor2">
                {progress?.phase === "remotes" ? language.risuAccountCheckingRemotes(progress.done) : language.risuAccountChecking}
            </p>
            <ShButton variant="ghost" size="sm" disabled={busy} onclick={() => run(() => forageStorage.cancelRisuAccountImport())}>{language.cancel}</ShButton>
        </div>
    {/if}

    {#if summary}
        <div class="flex flex-col gap-3 mt-3">
            <ul class="list-disc pl-5 text-sm text-textcolor">
                <li>{language.risuAccountSummaryCharacters(summary.characters)}</li>
                <li>{language.risuAccountSummaryChats(summary.chats)}</li>
                <li>{language.risuAccountSummaryAssets(summary.assets, summary.assetsStaged)}</li>
                {#if summary.cold > 0}
                    <li>{language.risuAccountSummaryCold(summary.cold)}</li>
                {/if}
                <li>{language.risuAccountEstimate(formatDuration(summary.estimatedSeconds))}</li>
            </ul>
            {#if summary.unresolvedRemotes > 0}
                <ShAlert variant="warning">
                    {#snippet icon()}<TriangleAlertIcon />{/snippet}
                    {language.risuAccountUnresolvedRemotes(summary.unresolvedRemotes)}
                </ShAlert>
            {/if}
            {#if summary.damaged > 0}
                <ShAlert variant="warning">
                    {#snippet icon()}<TriangleAlertIcon />{/snippet}
                    {language.risuAccountDamaged(summary.damaged, summary.damagedNames.join(", "))}
                </ShAlert>
            {/if}
            {#if summary.skipped > 0}
                <p class="text-xs text-textcolor2">{language.risuAccountSkipped(summary.skipped)}</p>
            {/if}
            <ShAlert variant="destructive">
                {#snippet icon()}<TriangleAlertIcon />{/snippet}
                {language.risuAccountStartWarn}
            </ShAlert>
            <div class="flex flex-col gap-1 text-xs text-textcolor2">
                <p>{language.risuAccountSnapshotNote}</p>
                <p>{language.risuAccountInlayNote}</p>
            </div>
            <div class="flex flex-wrap justify-end gap-2">
                <ShButton variant="ghost" size="sm" disabled={busy} onclick={() => run(() => forageStorage.cancelRisuAccountImport())}>{language.cancel}</ShButton>
                <ShButton variant="primary" size="sm" disabled={busy} onclick={start}>{language.risuAccountStart}</ShButton>
            </div>
        </div>
    {/if}
</div>

<RisuAccountLoginDialog bind:open={loginOpen} {onLogin} />
