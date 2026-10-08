import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/archive/canonical-json";

describe("canonicalJson", () => {
  it("canonicalJson_keysInAnyOrder_serialiseIdentically", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: "x" } })).toBe(canonicalJson({ a: { c: "x", d: [1, 2] }, b: 1 }));
  });

  it("canonicalJson_nestedValues_sortedAndCompact", () => {
    expect(canonicalJson({ z: null, a: [true, { y: 1, x: "é\n" }] })).toBe('{"a":[true,{"x":"é\\n","y":1}],"z":null}');
  });

  it("canonicalJson_undefinedProperty_isOmittedLikeJsonStringify", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("canonicalJson_emptyContainers_serialise", () => {
    expect(canonicalJson({ a: [], b: {} })).toBe('{"a":[],"b":{}}');
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a Date", new Date(0)],
    ["a function", () => 1],
    ["undefined at the top level", undefined],
    ["undefined inside an array", [undefined]],
  ])("canonicalJson_%s_throws", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });
});
