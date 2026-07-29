import type { ComponentType } from "react";

/**
 * Prototype discovery.
 *
 * `import.meta.glob` rather than the file-based router the three apps use. A
 * generated route tree would churn on every prototype added or deleted, in the
 * one directory this repo requires to stay empty on `main` — and a required
 * check fails any PR to `main` whose diff touches it. Globbing means a
 * prototype is a file you drop in and delete again, with no generated residue.
 *
 * The type parameter is an assertion, not a guarantee: `lab/prototypes/` is
 * excluded from typecheck by design, so nothing proves a prototype module has a
 * default export until it is loaded. {@link loadPrototype} checks at runtime
 * and reports the file that is wrong rather than failing as a blank screen.
 */
export interface PrototypeModule {
  default: ComponentType;
}

export interface PrototypeEntry {
  /** Path-derived, stable, and URL-safe: `admin/section-nav`. */
  id: string;
  /** Derived from the id purely for display: `Admin / Section nav`. */
  title: string;
  /** Path relative to the repo root, shown so the file is easy to find. */
  sourcePath: string;
}

// The pattern must be a string literal in the call: `import.meta.glob` is
// resolved by vite at transform time, not at runtime, so a variable here would
// produce an empty record with no error.
const modules = import.meta.glob<PrototypeModule>("../../prototypes/**/*.tsx");

function toId(globKey: string): string {
  return globKey
    .replace("../../prototypes/", "")
    .replace(/\.tsx$/, "")
    .replace(/\/index$/, "");
}

function toTitle(id: string): string {
  return id
    .split("/")
    .map((segment) => segment.replace(/-/g, " "))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" / ");
}

/** Every prototype currently on disk, sorted by id. */
export const prototypes: PrototypeEntry[] = Object.keys(modules)
  .map((globKey) => {
    const id = toId(globKey);

    return {
      id,
      title: toTitle(id),
      sourcePath: globKey.replace("../../", "lab/"),
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

export function findPrototype(id: string): PrototypeEntry | undefined {
  return prototypes.find((entry) => entry.id === id);
}

/**
 * Dynamically imports the prototype module for `id`.
 *
 * Rejects with a message naming the file when the module has no default export
 * — the most likely mistake in a directory nothing typechecks.
 */
export async function loadPrototype(id: string): Promise<PrototypeModule> {
  const globKey = Object.keys(modules).find((candidate) => toId(candidate) === id);
  const load = globKey === undefined ? undefined : modules[globKey];

  if (load === undefined) {
    throw new Error(`No prototype named "${id}" in lab/prototypes/.`);
  }

  const loaded = await load();

  // `memo`, `forwardRef` and `lazy` components are OBJECTS carrying a
  // `$$typeof` symbol, not functions. A bare `typeof !== "function"` rejects
  // them with a message insisting they are not React components, which is both
  // wrong and the most confusing possible thing to read while prototyping.
  const component: unknown = loaded.default;
  const isRenderable =
    typeof component === "function" ||
    (typeof component === "object" && component !== null && "$$typeof" in component);

  if (!isRenderable) {
    throw new Error(
      `lab/prototypes/${id}.tsx must have a default export that is a React component.`,
    );
  }

  return loaded;
}
