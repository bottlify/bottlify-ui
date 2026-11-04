/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

/**
 * Decompression, as the stores read their protocols' compressed parts: a
 * CM's gzipped messages, Valve's zipped client files. The platform's
 * DecompressionStream does it -- except in a content script's world in
 * Safari, which refuses it ("Invalid type should be ArrayBuffer"); a store
 * run in a tab of its site there has it done by the worker (tab-session.js,
 * relay.js), which `inflateWith` sets for that tab's page alone.
 */

/** @typedef {'gzip' | 'deflate' | 'deflate-raw'} Format */

/** @param {Uint8Array} bytes @param {Format} format @returns {Promise<Uint8Array>} */
export async function nativeInflate(bytes, format){
    // A copy of its own: a view into a larger buffer, or one of another world, is refused.
    const own = Uint8Array.from(bytes);
    const stream = new Blob([own]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

let inflater = nativeInflate;

/** @param {Uint8Array} bytes @param {Format} format */
export const inflate = (bytes, format)=>inflater(bytes, format);

/** Where this page's decompression is done. @param {typeof nativeInflate} done */
export function inflateWith(done){
    inflater = done;
}
