/**
 * Deterministic JSON: object keys sorted, no whitespace. Two structurally equal values always
 * serialise to the same string, so a signature over it survives re-formatting the file (a text
 * editor or a JSON viewer may reorder keys or re-indent).
 *
 * Only plain JSON values are accepted: functions, non-finite numbers, Dates and class instances
 * are rejected so that what is signed is exactly what is stored. As in JSON.stringify, an object
 * property whose value is undefined is omitted (an absent optional field).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  throw new TypeError(`canonicalJson: unsupported value of type ${typeof value}`);
}
