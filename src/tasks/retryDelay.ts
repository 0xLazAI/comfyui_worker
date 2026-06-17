/**
 * Resolves the retry backoff delay (in seconds) for a given attempt from a backoff schedule.
 *
 * Attempt numbers are 1-based; the schedule is indexed by `attemptNo - 1` and clamps to the final
 * entry once the attempt count exceeds the schedule length. Returns 0 when no schedule is provided.
 */
export function computeRetryDelaySeconds(backoffSeconds: number[], attemptNo: number): number {
  if (!backoffSeconds.length) {
    return 0;
  }
  const index = Math.max(0, attemptNo - 1);
  return backoffSeconds[index] ?? backoffSeconds[backoffSeconds.length - 1] ?? 0;
}
