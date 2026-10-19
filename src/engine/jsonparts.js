/**
 * A value's JSON as pieces for a Blob to join. One string has a length limit
 * (about 512 MB in V8) that a diagnostics dump -- the draws of many frames,
 * every texture kept -- can pass, while its parts do not. Objects and arrays
 * are opened down to `depth` levels; below that a value is one piece.
 *
 * @param {unknown} value
 * @param {number} [depth]
 * @param {string[]} [parts]
 * @returns {string[]}
 */
export function jsonParts(value, depth = 4, parts = []) {
  if (depth > 0 && Array.isArray(value)) {
    parts.push("[");
    value.forEach((item, index) => {
      if (index > 0) parts.push(",");
      // As JSON.stringify writes them in an array.
      jsonParts(item === undefined || typeof item === "function" ? null : item, depth - 1, parts);
    });
    parts.push("]");
    return parts;
  }
  if (depth > 0 && value !== null && typeof value === "object"
    && typeof (/** @type {any} */ (value)).toJSON !== "function") {
    parts.push("{");
    let first = true;
    for (const [key, item] of Object.entries(value)) {
      // And as it leaves them out of an object.
      if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
      parts.push(`${first ? "" : ","}${JSON.stringify(key)}:`);
      first = false;
      jsonParts(item, depth - 1, parts);
    }
    parts.push("}");
    return parts;
  }
  parts.push(JSON.stringify(value) ?? "null");
  return parts;
}
