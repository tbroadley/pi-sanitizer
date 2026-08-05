/** Running tally of what the sanitizer has done, for `/sanitizer`.
 *
 *  Scoped to the process, not the session: pi loads an extension once and
 *  shares it across every session in that process (a long-lived host running
 *  many agents has one instance for all of them), so per-session counters
 *  here would be quietly wrong.
 */

export interface SanitizerStats {
  toolResultsSanitized: number;
  promptsCleaned: number;
  promptsBlocked: number;
  messagesStripped: number;
  editsRepaired: number;
  editsDenied: number;
}

export function createStats(): SanitizerStats {
  return {
    toolResultsSanitized: 0,
    promptsCleaned: 0,
    promptsBlocked: 0,
    messagesStripped: 0,
    editsRepaired: 0,
    editsDenied: 0,
  };
}

export function describeStats(stats: SanitizerStats): string {
  const entries: Array<[string, number]> = [
    ["tool results sanitized", stats.toolResultsSanitized],
    ["prompts cleaned", stats.promptsCleaned],
    ["prompts blocked", stats.promptsBlocked],
    ["replies stripped", stats.messagesStripped],
    ["edits re-anchored", stats.editsRepaired],
    ["edits denied", stats.editsDenied],
  ];
  const found = entries.filter(([, count]) => count > 0);
  if (found.length === 0) return "nothing found so far";
  return found.map(([label, count]) => `${label}: ${count}`).join(", ");
}
