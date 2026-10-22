<script lang="ts">
    import { onMount } from 'svelte';
    
    import { DBState } from 'src/ts/stores.svelte';
    import { longpress } from 'src/ts/gui/longtouch';

    let textarea:HTMLElement = $state();
    let previousScrollHeight = 0;
    interface Props {
        value?: string;
        handleLongPress?: any;
    }

  let { value = $bindable(''), handleLongPress = (e:MouseEvent) => {} }: Props = $props();

    function resize() {
        // The 0px reset briefly shrinks the chat scroller; when the view is near its far end the
        // browser clamps scrollTop and the screen jumps, so put every ancestor's offset back.
        const scrollTops: [HTMLElement, number][] = [];
        for (let el = textarea.parentElement; el; el = el.parentElement) {
            if (el.scrollTop !== 0) scrollTops.push([el, el.scrollTop]);
        }
        textarea.style.height = '0px'; // Reset the textarea height
        textarea.style.height = `calc(${textarea.scrollHeight}px + 1rem)`; // Set the new height
        for (const [el, top] of scrollTops) el.scrollTop = top;
    }

    function handleInput() {
        if (textarea.scrollHeight !== previousScrollHeight) {
            previousScrollHeight = textarea.scrollHeight;
            resize();
        }
    }

    onMount(() => {
        resize();
    });
</script>
  
<textarea
    bind:this={textarea}
    oninput={handleInput}
    use:longpress={handleLongPress}
    bind:value={value}
    class="rounded-md p-2 text-textcolor bg-transparent resize-none overflow-y-hidden border border-darkborderc w-full message-edit-area"
    style:font-size="{0.875 * (DBState.db.zoomsize / 100)}rem"
    style:line-height="{(DBState.db.lineHeight ?? 1.25) * (DBState.db.zoomsize / 100)}rem"
></textarea>