/**
 * Turns a title into the slug the API's schema accepts:
 * `[a-z0-9][a-z0-9-]*`.
 *
 * Accents are folded rather than dropped (`Café` becomes `cafe`, not `caf`) by
 * decomposing to NFD and removing the combining marks, so a titled post keeps a
 * readable URL instead of a mangled one.
 *
 * Returns `""` for a title with nothing usable in it — an emoji-only title, or
 * one still being typed. The caller leaves the field empty in that case rather
 * than writing a slug the form's `pattern` would reject.
 */
export function slugifyTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
