/** Ingress: sanitize tool output before the model reads it.
 *
 *  This is where the payload usually arrives: text an operator never sees (an
 *  HTML comment, a zero-width run, a line the terminal paints invisible) that
 *  the model reads as if it were instructions. Every layer here is a
 *  deterministic byte-level transform, not a classifier: we are not trying to
 *  decide whether text is *malicious*, only to make sure the model and the
 *  human see the same bytes.
 */

import { sanitizeText, composeContext } from "agent-sanitizer/output";
import { HTML_EXEMPT_TOOLS, HTML_MAX_BYTES, type SanitizerPolicy } from "./policy.js";

export interface TextPart {
  type: "text";
  text: string;
}

export type ContentPart = TextPart | { type: string; [key: string]: unknown };

function isTextPart(part: ContentPart): part is TextPart {
  return part.type === "text" && typeof (part as TextPart).text === "string";
}

export interface IngressResult {
  content: ContentPart[];
  /** Warnings from every layer, already deduplicated. */
  warnings: string[];
  /** True when bytes changed (as opposed to a report-only finding). */
  modified: boolean;
}

/** Sanitize one tool result's content parts.
 *
 *  Returns `undefined` when nothing was found, so the caller can leave the
 *  result completely untouched — the common case, and the one that must stay
 *  free of overhead and of spurious notes in the transcript.
 *
 *  The model-facing note is appended as its OWN text part rather than glued
 *  onto the output. A file read must stay byte-identical to the sanitized
 *  view of the file so `edit-repair` can map an edit back onto disk; mixing a
 *  warning into that part would break the mapping.
 */
export async function sanitizeToolResult(
  policy: SanitizerPolicy,
  toolName: string,
  content: readonly ContentPart[],
): Promise<IngressResult | undefined> {
  if (!policy.enabled || !policy.ingress) return undefined;
  if (policy.skipTools.has(toolName)) return undefined;

  const useHtml = policy.html && !HTML_EXEMPT_TOOLS.has(toolName);
  const useExfil = policy.exfilScan && !HTML_EXEMPT_TOOLS.has(toolName);

  const warnings: string[] = [];
  const out: ContentPart[] = [];
  let modified = false;

  for (const part of content) {
    if (!isTextPart(part)) {
      out.push(part);
      continue;
    }
    const small = part.text.length <= HTML_MAX_BYTES;
    const result = await sanitizeText(part.text, {
      html: useHtml && small,
      exfilScan: useExfil && small,
    });
    for (const warning of result.warnings) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }
    if (result.cleaned !== part.text) modified = true;
    out.push(result.cleaned === part.text ? part : { ...part, text: result.cleaned });
  }

  if (!modified && warnings.length === 0) return undefined;

  out.push({ type: "text", text: `[pi-sanitizer] ${composeContext(modified, warnings)}` });
  return { content: out, warnings, modified };
}

/** Fail-closed replacement for a result we could not vet.
 *
 *  A sanitizer that throws has told us nothing about the bytes it was handed,
 *  so passing them through would be strictly worse than the tool having
 *  failed. Non-text parts are dropped for the same reason. */
export function suppressedContent(toolName: string, error: unknown): ContentPart[] {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    {
      type: "text",
      text:
        `[pi-sanitizer] Sanitizing the ${toolName} output failed, so the output was ` +
        `suppressed rather than shown unvetted: ${detail}`,
    },
  ];
}
