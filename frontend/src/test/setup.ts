import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-cleans when the test globals are enabled, which
// we don't use (tests import from "vitest" explicitly).
afterEach(cleanup);

// jsdom has no matchMedia; platform.ts's isStandalonePwa() calls it on every API request.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) as MediaQueryList;
}
