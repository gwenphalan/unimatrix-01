import { describe, expect, it } from "vitest";

import {
  hasValidatedRedirectUrl,
  safeRedirectUrl,
  withRedirectParam,
} from "@/features/auth/safe-redirect";

describe("safeRedirectUrl", () => {
  it("honors the root domain over https", () => {
    expect(safeRedirectUrl("https://unimatrix-01.dev/projects")).toBe(
      "https://unimatrix-01.dev/projects",
    );
  });

  it("honors subdomains over https", () => {
    expect(safeRedirectUrl("https://cflop.unimatrix-01.dev/oll")).toBe(
      "https://cflop.unimatrix-01.dev/oll",
    );
  });

  it("rejects the root domain over http (downgrade)", () => {
    expect(safeRedirectUrl("http://unimatrix-01.dev/")).toBe("/");
  });

  it("allows localhost on any port and scheme for local dev", () => {
    expect(safeRedirectUrl("http://localhost:5173/")).toBe("http://localhost:5173/");
    expect(safeRedirectUrl("http://127.0.0.1:4173/")).toBe("http://127.0.0.1:4173/");
  });

  it("rejects lookalike domains", () => {
    expect(safeRedirectUrl("https://evilunimatrix-01.dev/")).toBe("/");
    expect(safeRedirectUrl("https://unimatrix-01.dev.attacker.com/")).toBe("/");
    expect(safeRedirectUrl("https://attacker.com/unimatrix-01.dev")).toBe("/");
  });

  it("rejects unrelated origins and non-http schemes", () => {
    expect(safeRedirectUrl("https://example.com/")).toBe("/");
    expect(safeRedirectUrl("javascript:alert(1)")).toBe("/");
    expect(safeRedirectUrl("//evil.com")).toBe("/");
  });

  it("rejects relative paths and empty/undefined input", () => {
    expect(safeRedirectUrl("/projects")).toBe("/");
    expect(safeRedirectUrl("")).toBe("/");
    expect(safeRedirectUrl(undefined)).toBe("/");
  });

  it("honors a custom fallback", () => {
    expect(safeRedirectUrl("https://example.com/", "/sign-in")).toBe("/sign-in");
  });
});

describe("hasValidatedRedirectUrl", () => {
  it("is true when raw passed the allowlist and produced target", () => {
    const raw = "https://cflop.unimatrix-01.dev/oll";

    expect(hasValidatedRedirectUrl(raw, safeRedirectUrl(raw))).toBe(true);
  });

  it("is false when raw is absent", () => {
    expect(hasValidatedRedirectUrl(undefined, safeRedirectUrl(undefined))).toBe(false);
  });

  it("is false when raw was rejected and target is the fallback", () => {
    const raw = "https://attacker.com/";

    expect(hasValidatedRedirectUrl(raw, safeRedirectUrl(raw))).toBe(false);
  });

  it("is false for the literal fallback path, even though it would equal target", () => {
    // "/" fails isAllowedRedirectUrl (not absolute) and safeRedirectUrl falls
    // back to "/" — the same string a caller could pass as raw. Without the
    // `target !== "/"` guard this would read as a validated redirect.
    expect(hasValidatedRedirectUrl("/", safeRedirectUrl("/"))).toBe(false);
  });
});

describe("withRedirectParam", () => {
  it("appends an encoded redirect_url when present", () => {
    expect(withRedirectParam("/sign-up", "https://unimatrix-01.dev/a?b=c")).toBe(
      "/sign-up?redirect_url=https%3A%2F%2Funimatrix-01.dev%2Fa%3Fb%3Dc",
    );
  });

  it("returns the bare path when no redirect_url is given", () => {
    expect(withRedirectParam("/sign-up", undefined)).toBe("/sign-up");
    expect(withRedirectParam("/sign-up", "")).toBe("/sign-up");
  });
});
