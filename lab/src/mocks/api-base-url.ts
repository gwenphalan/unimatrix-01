/**
 * The lab's API base URL. Hardcoded, localhost, and never read from an
 * environment variable.
 *
 * Local-only hosting removes the production-bundle risk but not this one: a
 * prototype pointed at `https://api.unimatrix-01.dev` with a real token can
 * mutate live content from a laptop, and the lab is by construction the
 * least-reviewed code in the repo. A `VITE_API_BASE_URL` here would be exactly
 * the knob that makes that a one-line accident, so there is no knob.
 *
 * Nothing in `src/mocks/` actually fetches. This constant exists so a prototype
 * that wants to *display* an API origin has one to display, and so the
 * assertion below is a real check rather than decoration.
 */
export const LAB_API_BASE_URL = "http://localhost:3000";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Throws unless `url` points at the local machine.
 *
 * Called once at module load against {@link LAB_API_BASE_URL}, so editing that
 * constant to a remote origin fails loudly the moment the harness boots rather
 * than quietly working. Exported so a prototype that takes a URL from a text
 * field can apply the same rule.
 */
export function assertLocalhostUrl(url: string): void {
  let hostname: string;

  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`Lab API URL is not a valid URL: ${url}`);
  }

  if (!LOCAL_HOSTNAMES.has(hostname)) {
    throw new Error(
      `Lab API URL must point at localhost; received ${url}. The prototyping harness is local-dev only and must never be able to reach a deployed API.`,
    );
  }
}

assertLocalhostUrl(LAB_API_BASE_URL);
