/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * A value as an extension's port carries it: ports send JSON, so bytes (a
 * depot's key, Valve's client files) and big integers are written as tagged
 * objects on one side and read back on the other, the rest as it is. Read
 * back by the page (the launcher), which may be handed real bytes as well,
 * by a frame: those are left as they are.
 */

/** @param {Uint8Array} bytes */
function base64Of(bytes){
    let text = '';
    for (let at = 0; at < bytes.length; at += 0x8000)
    {
        text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    }
    return btoa(text);
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function toWire(value){
    if (value instanceof Uint8Array)
    {
        return { $bytes: base64Of(value) };
    }
    if (typeof value === 'bigint')
    {
        return { $bigint: String(value) };
    }
    if (Array.isArray(value))
    {
        return value.map(toWire);
    }
    if (value && typeof value === 'object')
    {
        return Object.fromEntries(Object.entries(value).map(([key, one])=>[key, toWire(one)]));
    }
    return value;
}

/**
 * @param {unknown} value
 * @returns {any}
 */
export function fromWire(value){
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer)
    {
        return value;
    }
    if (Array.isArray(value))
    {
        return value.map(fromWire);
    }
    if (value && typeof value === 'object')
    {
        const tagged = /** @type {Record<string, unknown>} */ (value);
        if (typeof tagged.$bytes === 'string')
        {
            return Uint8Array.from(atob(tagged.$bytes), c=>c.charCodeAt(0));
        }
        if (typeof tagged.$bigint === 'string')
        {
            return BigInt(tagged.$bigint);
        }
        return Object.fromEntries(Object.entries(tagged).map(([key, one])=>[key, fromWire(one)]));
    }
    return value;
}
