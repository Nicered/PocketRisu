<script lang="ts">
    // RisuAI's own login page in a frame. It posts the login token back to
    // this window, which hands it to onLogin; the password never passes
    // through PocketRisu.
    import { language } from "src/lang";
    import ShDialog from "src/lib/UI/GUI/ShDialog.svelte";
    import { forageStorage } from "src/ts/globalApi.svelte";
    import { showAccountError } from "./risuAccountImportUi";

    let { open = $bindable(false), onLogin }: {
        open?: boolean,
        onLogin: (token: string, id: string) => void,
    } = $props();

    let loginUrl = $state("");
    let loginOrigin = "";
    let loginFrame = $state<HTMLIFrameElement | null>(null);

    $effect(() => {
        if (open && !loginUrl) void loadConfig();
    });

    async function loadConfig() {
        try {
            const config = await forageStorage.getRisuAccountImportConfig();
            loginOrigin = config.loginOrigin;
            loginUrl = config.loginUrl;
        } catch (error) {
            open = false;
            showAccountError(error);
        }
    }

    function onMessage(event: MessageEvent) {
        if (!open || event.origin !== loginOrigin) return;
        if (!loginFrame || event.source !== loginFrame.contentWindow) return;
        const msg = event.data?.msg;
        if (!msg?.data?.vaild || typeof msg.token !== "string" || msg.token === "") return;
        // The login page posts the same message several times; the first
        // one closes the dialog and the rest find it closed.
        open = false;
        onLogin(msg.token, typeof msg.id === "string" ? msg.id : "");
    }
</script>

<svelte:window onmessage={onMessage} />

<ShDialog bind:open size="lg">
    {#snippet title()}{language.risuAccountLoginTitle}{/snippet}
    {#snippet description()}{language.risuAccountLoginDesc}{/snippet}
    {#if open && loginUrl}
        <iframe bind:this={loginFrame} src={loginUrl} title={language.risuAccountLoginTitle} class="block w-full h-[60vh] rounded-md border border-darkborderc bg-white"></iframe>
    {/if}
</ShDialog>
