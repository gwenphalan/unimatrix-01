/**
 * jsdom ships no `window.matchMedia`, so anything reading a media query has
 * to be given one. Shared by the hook tests and the `CircuitField` gate test
 * because both need the same two things: a registry they can flip after
 * mount, and a permissive default for queries they did not list.
 *
 * Lives under `test/helpers/` rather than beside the suites: the Vitest
 * `include` is `test/**\/*.test.ts(x)`, so a file named like this one is
 * never collected as a suite of its own.
 */
export class FakeMediaQueryList {
  matches: boolean;
  private readonly listeners = new Set<() => void>();

  constructor(
    public readonly media: string,
    matches: boolean,
  ) {
    this.matches = matches;
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === "change") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === "change") this.listeners.delete(listener);
  }

  setMatches(value: boolean): void {
    this.matches = value;
    this.listeners.forEach((listener) => {
      listener();
    });
  }
}

/**
 * Installs the stub and returns the registry. A query absent from `initial`
 * resolves to a live, non-matching entry rather than throwing, so a component
 * that reads more queries than the test cares about still mounts.
 */
export function stubMatchMedia(initial: Record<string, boolean>): Map<string, FakeMediaQueryList> {
  const registry = new Map<string, FakeMediaQueryList>();
  Object.entries(initial).forEach(([query, matches]) =>
    registry.set(query, new FakeMediaQueryList(query, matches)),
  );

  window.matchMedia = ((query: string) => {
    let mql = registry.get(query);
    if (!mql) {
      mql = new FakeMediaQueryList(query, false);
      registry.set(query, mql);
    }
    return mql;
  }) as unknown as typeof window.matchMedia;

  return registry;
}
