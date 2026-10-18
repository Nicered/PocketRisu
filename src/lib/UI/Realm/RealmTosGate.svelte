<script lang="ts">
    import { language } from "src/lang";
    import { alertTOS } from "src/ts/alert";
    import ShButton from "../GUI/ShButton.svelte";
</script>
<!-- Shown where Realm would load on its own before RisuAI's terms are
     accepted. Accepting flips risuTosAccepted, and the parent swaps in the
     real Realm view. -->
<div class="w-full flex flex-col items-center gap-3 p-6 text-center">
    <p class="text-textcolor2">{language.risuTosGate}</p>
    <ShButton variant="outline" onclick={() => alertTOS()}>{language.risuTosGateButton}</ShButton>
</div>
