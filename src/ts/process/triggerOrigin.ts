import { get } from 'svelte/store'
import { requestImmediateSave, trackChatForSave } from '../globalApi.svelte'
import { normalizeChat, type Chat, type character } from '../storage/database.svelte'
import { DBState, selectedCharID } from '../stores.svelte'

/**
 * The chat a button or form trigger started on. The trigger is awaited and the
 * user can open another chat or character before it finishes; setCurrentChat
 * would then write the result over whichever chat is open by that time.
 */
export interface TriggerOrigin {
    chaId: string
    chat: Chat
}

export function getTriggerOrigin(char: character): TriggerOrigin {
    return { chaId: char.chaId, chat: char.chats[char.chatPage] }
}

/**
 * Writes a trigger's resulting chat back to the chat it started on. Returns
 * false, writing nothing, when that chat no longer exists.
 */
export function setTriggerOriginChat(origin: TriggerOrigin, chat: Chat): boolean {
    const char = DBState.db.characters?.find((c) => c?.chaId === origin.chaId)
    if(!char){
        return false
    }
    // The chats may have been reordered meanwhile, or the slot replaced by sync.
    let index = char.chats.indexOf(origin.chat)
    if(index === -1 && origin.chat.id){
        index = char.chats.findIndex((c) => c?.id === origin.chat.id)
    }
    if(index === -1){
        return false
    }
    char.chats[index] = normalizeChat(chat)
    // Only the chat on screen is tracked for saving; queue any other chat or
    // the write is lost on reload.
    const isOpen = DBState.db.characters[get(selectedCharID)]?.chaId === origin.chaId && char.chatPage === index
    if(!isOpen){
        trackChatForSave(char.chaId, char.chats[index].id)
        void requestImmediateSave()
    }
    return true
}
