import { ApiClientError } from "@unimatrix/api-client";

/**
 * The retry policy every admin query uses.
 *
 * A 4xx is never retried: every call this app makes needs a valid `auth:admin`
 * session, so a client error is a 401 or a 403 rather than a blip, and retrying
 * it only delays the message the operator needs to read. Anything else — a 5xx,
 * a transport failure — gets exactly one retry.
 *
 * Safe on any query read through `useQuery` inside a component that renders its
 * own pending and error states. **Do not put one in a route loader without also
 * setting `retry: false`** — awaited through `ensureQueryData`, any retry above
 * `0` leaves the promise unsettled and the route renders nothing at all.
 */
export function retryUnlessClientError(failureCount: number, error: Error): boolean {
  if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) {
    return false;
  }

  return failureCount < 1;
}
