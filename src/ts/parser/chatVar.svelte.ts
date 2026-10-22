import { get } from 'svelte/store'
import { DBState, selectedCharID } from '../stores.svelte'
import type { Chat } from '../storage/database.svelte'
import { parseKeyValue } from '../util'

export function getChatVar(key:string): string {
    const selectedChar = get(selectedCharID)
    const char = DBState.db.characters[selectedChar]
    if(!char){
        return 'null'
    }
    return getChatVarOf(char.chats[char.chatPage], key, char.defaultVariables)
}

/** getChatVar for a given chat instead of the open one. */
export function getChatVarOf(chat:Chat, key:string, defaultVariables?:string): string {
    chat.scriptstate ??= {}
    const state = (chat.scriptstate['$' + key])
    if(state === undefined || state === null){
        const defaults = parseKeyValue(defaultVariables).concat(parseKeyValue(DBState.db.templateDefaultVariables))
        const findResult = defaults.find((f) => {
            return f[0] === key
        })
        if(findResult){
            return findResult[1]
        }
        return 'null'
    }
    return state.toString()
}

export function setChatVar(key:string, value:string): boolean {
    const selectedChar = get(selectedCharID)
    return setChatVarOf(DBState.db.characters[selectedChar].chats[DBState.db.characters[selectedChar].chatPage], key, value)
}

/** setChatVar for a given chat instead of the open one. */
export function setChatVarOf(chat:Chat, key:string, value:string): boolean {
    chat.scriptstate ??= {}

    const stateKey = '$' + key
    if(chat.scriptstate[stateKey] === value){
        return false
    }

    chat.scriptstate[stateKey] = value
    return true
}

export function getGlobalChatVar(key:string): string {
    return DBState.db.globalChatVariables[key] ?? 'null'
}
