/** Egress: strip hidden bytes from what the agent itself emits.
 *
 *  Ingress protects this agent. Egress protects everyone downstream of it —
 *  the human reading the transcript, the monitor grading it, and the next
 *  agent that gets handed this one's notes. A model that can emit zero-width
 *  runs has a side channel to all three, and unlike tool output nobody is
 *  inclined to check it, because it "came from us".
 *
 *  Two things are deliberately left alone:
 *
 *  - `thinking` parts. Providers sign reasoning blocks and reject a replayed
 *    context whose signature no longer matches the bytes, so rewriting them
 *    breaks the next request rather than the attack.
 *  - `toolCall` parts. By the time a message is finalized the arguments have
 *    already been dispatched; rewriting them here would only desynchronize
 *    the transcript from what actually ran. Hidden bytes an agent writes into
 *    a *file* are caught on the way back in, when something reads that file.
 */

import { applyLayer1 } from "agent-sanitizer";

export interface MessageLike {
  role: string;
  content: unknown;
  [key: string]: unknown;
}

export interface EgressResult {
  message: MessageLike;
  /** Category codes Layer 1 neutralized, e.g. `["cf-format", "ansi"]`. */
  found: string[];
}

/** Returns the rewritten message, or `undefined` when there was nothing to
 *  strip (the overwhelming majority of messages). */
export function sanitizeAssistantMessage(message: MessageLike): EgressResult | undefined {
  if (message.role !== "assistant") return undefined;
  if (!Array.isArray(message.content)) return undefined;

  const found: string[] = [];
  let changed = false;

  const content = message.content.map((part: unknown) => {
    if (
      !part ||
      typeof part !== "object" ||
      (part as { type?: unknown }).type !== "text" ||
      typeof (part as { text?: unknown }).text !== "string"
    ) {
      return part;
    }
    const text = (part as { text: string }).text;
    const result = applyLayer1(text);
    if (result.cleaned === text) return part;
    changed = true;
    for (const code of result.found) if (!found.includes(code)) found.push(code);
    return { ...(part as object), text: result.cleaned };
  });

  if (!changed) return undefined;
  return { message: { ...message, content }, found };
}
