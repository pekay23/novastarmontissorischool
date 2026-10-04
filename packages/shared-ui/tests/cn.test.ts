/**
 * `cn` — the one function every component in this package depends on.
 *
 * It is `twMerge(clsx(...))`, so what is actually being pinned here is a
 * dependency's contract rather than local logic, and that is worth doing
 * explicitly: the whole point of the wrapper is that a caller's `className`
 * *wins* over the component's own classes, and that promise comes from
 * tailwind-merge. If a version bump changed how conflicts resolve, every
 * component in the design system would silently restyle at once, and the
 * failure would surface as a screenshot nobody connected to a dependency bump.
 */
import { describe, expect, test } from "bun:test";
import { cn } from "../src/lib/utils";

describe("cn", () => {
  test("a later class beats an earlier one in the same Tailwind group", () => {
    // The reason the wrapper exists: a caller passing `p-8` must not lose to a
    // component that hardcodes `p-4`.
    expect(cn("p-4", "p-8")).toBe("p-8");
    expect(cn("bg-background", "bg-destructive")).toBe("bg-destructive");
  });

  test("classes from different groups are both kept", () => {
    expect(cn("p-4", "text-sm")).toBe("p-4 text-sm");
  });

  test("falsy entries are dropped rather than stringified", () => {
    expect(cn("p-4", false, undefined, null, "", 0 as never, "text-sm")).toBe("p-4 text-sm");
  });

  test("accepts the conditional forms clsx supports", () => {
    expect(cn(["p-4", "text-sm"], { "font-bold": true, "italic": false })).toBe(
      "p-4 text-sm font-bold",
    );
  });

  test("with nothing to merge it returns an empty string, not undefined", () => {
    expect(cn()).toBe("");
  });
});