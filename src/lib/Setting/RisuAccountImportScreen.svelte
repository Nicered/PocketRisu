<script lang="ts">
    // Full-screen view of a started RisuAI account import. bootstrap.ts shows
    // it instead of the app (the database is not even loaded) until the
    // import is applied or cancelled, on every device; the page then reloads
    // into the normal app. The server does the work
    // (server/node/risu-account-import.cjs).
    import { onDestroy } from "svelte";
    import { language } from "src/lang";
    import ShButton from "src/lib/UI/GUI/ShButton.svelte";
    import ShAlert from "src/lib/UI/GUI/ShAlert.svelte";
    import { alertConfirm, alertError, alertStore, waitAlert } from "src/ts/alert";
    import { forageStorage } from "src/ts/globalApi.svelte";
    import type { RisuAccountImportStatus } from "src/ts/storage/nodeStorage";
    import { CheckIcon, CircleIcon, LoaderCircleIcon, TriangleAlertIcon } from "@lucide/svelte";
    import RisuAccountLoginDialog from "./RisuAccountLoginDialog.svelte";
    import { accountErrorText, formatBytes, formatDuration, showAccountError } from "./risuAccountImportUi";

    const POLL_MS = 1500;
    // While waiting for the user (another device may act meanwhile) and
    // after a failed status read.
    const SLOW_POLL_MS = 5000;

    let status = $state<RisuAccountImportStatus | null>(null);
    let loginOpen = $state(false);
    let busy = $state(false);
    let finishing = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshGeneration = 0;
    let destroyed = false;

    const importState = $derived(status?.state ?? null);
    const summary = $derived(status?.summary ?? null);
    const steps = $derived(status?.steps ?? null);
    const downloadPercent = $derived.by(() => {
        if (!steps) return 0;
        const total = steps.cold.total + steps.assets.total;
        return total > 0 ? Math.min(100, ((steps.cold.done + steps.assets.done) / total) * 100) : 0;
    });
    const applyPercent = $derived(steps?.apply?.total ? Math.min(100, (steps.apply.done / steps.apply.total) * 100) : 0);
    const missingGroups = $derived.by(() => {
        const groups = new Map<string, { kind: "asset" | "cold", reason: string, count: number }>();
        for (const item of status?.missing ?? []) {
            const key = `${item.kind}:${item.reason}`;
            const group = groups.get(key) ?? { kind: item.kind, reason: item.reason, count: 0 };
            group.count += 1;
            groups.set(key, group);
        }
        return [...groups.values()];
    });

    type StepState = "done" | "active" | "pending";
    const stepList = $derived.by(() => {
        const phase = status?.phase ?? null;
        const checking = importState === "preparing";
        const order = checking ? 0 : phase === "cold" ? 1 : phase === "assets" ? 2 : 3;
        const stateOf = (index: number): StepState => (index < order ? "done" : index === order ? "active" : "pending");
        const count = (done: number, total: number) => `${done.toLocaleString()}/${total.toLocaleString()}`;
        return [
            {
                label: language.risuAccountStepCheck,
                state: stateOf(0),
                detail: checking
                    ? (status?.progress?.phase === "remotes" ? language.risuAccountSummaryCharacters(status.progress.done) : "")
                    : summary ? language.risuAccountSummaryCharacters(summary.characters) : "",
            },
            {
                label: language.risuAccountStepCold,
                state: stateOf(1),
                detail: steps ? count(steps.cold.done, steps.cold.total) : "",
            },
            {
                label: language.risuAccountStepAssets,
                state: stateOf(2),
                detail: steps
                    ? `${count(steps.assets.done, steps.assets.total)}${steps.assets.bytes ? ` (${formatBytes(steps.assets.bytes)})` : ""}`
                    : "",
            },
            { label: language.risuAccountStepApply, state: stateOf(3), detail: "" },
        ];
    });

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
            // Applied or cancelled (here or on another device). Right after a
            // swap the server still removes the staged files while applying.
            if (!next.blocking && next.state !== "applying") {
                await finish(next);
                return;
            }
        }
        const active = next && (next.state === "preparing" || next.state === "downloading" || next.state === "applying");
        pollTimer = setTimeout(refresh, active ? POLL_MS : SLOW_POLL_MS);
    }

    async function finish(next: RisuAccountImportStatus) {
        if (finishing) return;
        finishing = true;
        const result = next.result;
        if (result) {
            const coldStorageWarnings = [
                result.coldStorageFailed ? `${result.coldStorageFailed} character(s)` : "",
                result.pluginStorageColdFailed ? `${result.pluginStorageColdFailed} plugin storage item(s)` : "",
            ].filter(Boolean);
            if (coldStorageWarnings.length > 0) {
                alertError(`Warning: ${coldStorageWarnings.join(" and ")} could not be restored from cold storage. The restored save may be incomplete. The app will now reload.`);
                await waitAlert();
            } else {
                alertStore.set({ type: "wait", msg: language.risuAccountDone });
            }
        }
        location.reload();
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

    async function cancelImport() {
        if (!(await alertConfirm(language.risuAccountCancelConfirm))) return;
        await run(() => forageStorage.cancelRisuAccountImport());
    }

    function onLogin(token: string, id: string) {
        void run(() => forageStorage.prepareRisuAccountImport(token, id));
    }

    refresh();

    onDestroy(() => {
        destroyed = true;
        if (pollTimer) clearTimeout(pollTimer);
    });
</script>

<div class="w-full h-full overflow-y-auto bg-bgcolor text-textcolor">
    <div class="max-w-xl mx-auto px-4 py-10 flex flex-col gap-5">
        {#if !status || (!status.blocking && importState !== "applying")}
            <!-- loading, or reloading after the import ended -->
            <div class="flex items-center gap-2 text-textcolor2">
                <LoaderCircleIcon class="size-5 animate-spin" />
                <span>Loading...</span>
            </div>
        {:else if importState === "needs-login"}
            {@const interrupted = status.error?.code === "ACCOUNT_IMPORT_INTERRUPTED"}
            <h1 class="text-xl font-semibold">{interrupted ? language.risuAccountInterruptedTitle : language.risuAccountScreenTitle}</h1>
            <ShAlert variant={interrupted || status.error?.code === "ACCOUNT_LOGIN_EXPIRED" ? "warning" : "destructive"}>
                {#snippet icon()}<TriangleAlertIcon />{/snippet}
                {accountErrorText(status.error) || language.risuAccountNeedsLogin}
            </ShAlert>
            {#if status.staged?.total}
                <p class="text-sm text-textcolor2 tabular-nums">{language.risuAccountStagedFiles(Math.min(status.staged.files, status.staged.total), status.staged.total)}</p>
            {/if}
            <p class="text-sm text-textcolor2">{language.risuAccountDataUnchanged}</p>
            <div class="flex flex-wrap justify-end gap-2">
                <ShButton variant="ghost" disabled={busy} onclick={cancelImport}>{language.risuAccountCancel}</ShButton>
                <ShButton variant="primary" disabled={busy} onclick={() => { loginOpen = true; }}>
                    {interrupted ? language.risuAccountReloginResume : language.risuAccountRelogin}
                </ShButton>
            </div>
        {:else if importState === "downloaded"}
            <h1 class="text-xl font-semibold">{language.risuAccountDownloaded}</h1>
            {#if status.error}
                <ShAlert variant="destructive">
                    {#snippet icon()}<TriangleAlertIcon />{/snippet}
                    {#snippet title()}{language.risuAccountApplyFailed}{/snippet}
                    {accountErrorText(status.error)}
                </ShAlert>
            {/if}
            {#if status.missingCount > 0}
                <p class="text-sm">{language.risuAccountMissingAsk(status.missingCount)}</p>
                <ul class="list-disc pl-5 text-sm text-textcolor2">
                    {#each missingGroups as group (group.kind + group.reason)}
                        <li>
                            {group.kind === "asset" ? language.risuAccountMissingAssets(group.count) : language.risuAccountMissingCold(group.count)},
                            {group.reason === "unreadable" ? language.risuAccountMissingUnreadable : language.risuAccountMissingNotFound}
                        </li>
                    {/each}
                    {#if status.missingCount > status.missing.length}
                        <li>…</li>
                    {/if}
                </ul>
                <p class="text-xs text-textcolor2">{language.risuAccountApplyAuto}</p>
            {/if}
            <div class="flex flex-wrap justify-end gap-2">
                <ShButton variant="ghost" disabled={busy} onclick={cancelImport}>{language.risuAccountCancel}</ShButton>
                <ShButton variant={status.missingCount > 0 ? "destructive" : "primary"} disabled={busy} onclick={() => run(() => forageStorage.applyRisuAccountImport())}>
                    {status.missingCount > 0 ? language.risuAccountApplyWithout : language.risuAccountApplyRetry}
                </ShButton>
            </div>
        {:else if importState === "applying"}
            <h1 class="text-xl font-semibold">{language.risuAccountApplyingTitle}</h1>
            <p class="text-sm text-textcolor2">{language.risuAccountApplyingDesc}</p>
            <div class="flex flex-col gap-1.5">
                <div class="w-full h-2 bg-bgcolor border border-darkborderc rounded-md overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(applyPercent)}>
                    <div class="h-full bg-primary transition-[width]" style:width={`${applyPercent}%`}></div>
                </div>
                <span class="text-sm text-textcolor2 tabular-nums self-end">{applyPercent.toFixed(1)}%</span>
            </div>
        {:else}
            <!-- preparing (a new login), downloading, paused -->
            <div class="flex flex-col gap-1">
                <h1 class="text-xl font-semibold">{language.risuAccountScreenTitle}</h1>
                <p class="text-sm text-textcolor2">{language.risuAccountScreenDesc}</p>
            </div>
            <ol class="flex flex-col gap-2">
                {#each stepList as step (step.label)}
                    <li class="flex items-center gap-2 text-sm" class:text-textcolor2={step.state === "pending"}>
                        {#if step.state === "done"}
                            <CheckIcon class="size-4 text-success shrink-0" />
                        {:else if step.state === "active" && importState !== "paused"}
                            <LoaderCircleIcon class="size-4 animate-spin shrink-0" />
                        {:else}
                            <CircleIcon class="size-4 shrink-0" />
                        {/if}
                        <span class="flex-1">{step.label}</span>
                        {#if step.detail}
                            <span class="tabular-nums text-textcolor2">{step.detail}</span>
                        {/if}
                    </li>
                {/each}
            </ol>
            <div class="flex flex-col gap-1.5">
                <div class="w-full h-2 bg-bgcolor border border-darkborderc rounded-md overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(downloadPercent)}>
                    <div class="h-full bg-primary transition-[width]" style:width={`${downloadPercent}%`}></div>
                </div>
                {#if status.remainingSeconds !== null}
                    <span class="text-sm text-textcolor2 self-end">{language.risuAccountRemaining(formatDuration(status.remainingSeconds))}</span>
                {/if}
            </div>
            {#if importState === "paused"}
                <ShAlert variant="warning">
                    {#snippet icon()}<TriangleAlertIcon />{/snippet}
                    {status.error?.code === "ACCOUNT_REQUEST_FAILED" ? language.risuAccountPaused : accountErrorText(status.error)}
                    {language.risuAccountKeptFiles}
                    {#if status.error?.code === "ACCOUNT_REQUEST_FAILED"}
                        <p class="text-xs opacity-80 mt-1 break-all">{status.error.message}</p>
                    {/if}
                </ShAlert>
            {/if}
            <p class="text-xs text-textcolor2">{language.risuAccountScreenNote}</p>
            <div class="flex flex-wrap justify-end gap-2">
                <ShButton variant="ghost" disabled={busy} onclick={cancelImport}>{language.risuAccountCancel}</ShButton>
                {#if importState === "paused"}
                    <ShButton variant="primary" disabled={busy} onclick={() => run(() => forageStorage.startRisuAccountDownload())}>{language.risuAccountRetry}</ShButton>
                {/if}
            </div>
        {/if}
    </div>
</div>

<RisuAccountLoginDialog bind:open={loginOpen} {onLogin} />
