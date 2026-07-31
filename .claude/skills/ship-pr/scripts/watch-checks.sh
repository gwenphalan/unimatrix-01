#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
watch-checks.sh <pr>

Emits each check result on a pull request as it lands, then stops once nothing
is pending. Arm it under `Monitor`, which wants one notification per occurrence.

`gh pr checks <pr> --watch` is the wrong tool here: it reports once, after
everything has reported, so a `Verify` failure two minutes in stays invisible
until the slowest job finishes ten minutes later and you sit on a fixable red
the whole time.

Every terminal bucket is printed — PASS, FAIL and SKIPPING alike. A filter that
matched only success would be silent through a failure, and silence is
indistinguishable from still-running.

A failed `gh` call is not an empty result. An expired token returning a
valid-looking empty list would leave the loop sleeping forever, which is the
same silence a slow CI run produces. Three consecutive failures print what `gh`
actually said and stop.

Arguments:
  <pr>   Pull request number, or anything `gh pr checks` accepts

Environment:
  SHIP_PR_POLL_SECONDS     Seconds between polls. Default 30.
  SHIP_PR_CHECKS_FIXTURES  Colon-separated entries consumed one per iteration in
                           place of the `gh` call. An entry is either a path to
                           a JSON file holding what
                           `gh pr checks <pr> --json name,bucket` would print,
                           or the form ERROR=<message>, standing in for a failed
                           call. No entry may contain a colon, which is the
                           separator. The run ends when the list is
                           exhausted. This is how the script is exercised
                           without a live PR, and a multi-entry list is how the
                           pending -> terminal transition is exercised.

Output:
  <BUCKET>  <check-name>   once, the first time that result appears
  API ERROR xN: <stderr>   three consecutive `gh` failures
  FIXTURES EXHAUSTED       offline runs only

Exit codes:
  0  nothing is pending any more, or the fixture list ran out
  1  bad usage
  2  three consecutive `gh` failures, or an unreadable fixture entry
EOF
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
esac

if [ "$#" -ne 1 ]; then
  usage >&2
  exit 1
fi

pr=$1
poll=${SHIP_PR_POLL_SECONDS:-30}

fixtures=()
offline=0
if [ -n "${SHIP_PR_CHECKS_FIXTURES:-}" ]; then
  offline=1
  IFS=: read -r -a fixtures <<<"$SHIP_PR_CHECKS_FIXTURES"
fi
step=0

prev=""
fails=0

while true; do
  rc=0

  # The fixture index has to advance in this shell: a `payload=$(helper)`
  # command substitution runs in a subshell, so the increment would be lost and
  # the loop would reread entry 0 forever.
  if [ "$offline" -eq 1 ]; then
    if [ "$step" -ge "${#fixtures[@]}" ]; then
      echo "FIXTURES EXHAUSTED"
      exit 0
    fi
    entry=${fixtures[$step]}
    step=$((step + 1))
    case $entry in
      ERROR=*)
        payload=${entry#ERROR=}
        rc=1
        ;;
      *)
        if [ -r "$entry" ]; then
          payload=$(cat "$entry")
        else
          payload="fixture not readable: $entry"
          rc=1
        fi
        ;;
    esac
  else
    payload=$(gh pr checks "$pr" --json name,bucket 2>&1) && rc=0 || rc=$?
  fi

  if [ "$rc" -eq 0 ]; then
    fails=0
    cur=$(jq -r '.[] | select(.bucket != "pending") | "\(.bucket | ascii_upcase)  \(.name)"' <<<"$payload" | sort)
    comm -13 <(printf '%s\n' "$prev") <(printf '%s\n' "$cur")
    prev=$cur
    if jq -e 'length > 0 and all(.[]; .bucket != "pending")' <<<"$payload" >/dev/null 2>&1; then
      exit 0
    fi
  else
    fails=$((fails + 1))
    if [ "$fails" -ge 3 ]; then
      printf 'API ERROR x%s: %s\n' "$fails" "$payload"
      exit 2
    fi
  fi

  sleep "$poll"
done
