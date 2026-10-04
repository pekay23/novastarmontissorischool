/**
 * Registers a DOM for `bun test`, and only for `bun test`.
 *
 * Preloaded from `bunfig.toml` because an ESM import is hoisted above anything a
 * test file runs, so registering the globals inside the test file would be too
 * late for the component module it is trying to render.
 *
 * Guarded on `process.env.NODE_ENV === "test"` so that a stray `bun run` in this
 * package which happens to load this file outside a test run installs nothing
 * into the real global object.
 */
import { JSDOM } from "jsdom";

if (process.env.NODE_ENV === "test") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  const globals = globalThis as unknown as Record<string, unknown>;
  for (const name of [
    "window",
    "document",
    "navigator",
    "location",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "MutationObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "localStorage",
    "sessionStorage",
  ] as const) {
    const value = (dom.window as unknown as Record<string, unknown>)[name];
    if (value !== undefined && globals[name] === undefined) globals[name] = value;
  }
}