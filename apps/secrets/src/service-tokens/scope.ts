/**
 * Whether a token scoped to `scopePrefix` reaches the secret called `name`.
 *
 * Segment-boundary containment, never a raw `startsWith`: `github` covers
 * `github` and `github/api-token` but must not cover `githubx/token`. The raw
 * form is a privilege escalation that reads as a typo.
 *
 * One prefix per token, and no wildcard or root scope — `secretNameSchema`
 * (`@unimatrix/shared`), which both sides of this comparison are validated
 * against, cannot express one. A consumer needing two namespaces gets two
 * tokens.
 */
export function scopeCoversName(scopePrefix: string, name: string): boolean {
  return name === scopePrefix || name.startsWith(`${scopePrefix}/`);
}
