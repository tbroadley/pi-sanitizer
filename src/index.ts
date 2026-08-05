/** pi-sanitizer — hidden-content defence for pi agents.
 *
 *  Four seams, all of them byte-level and deterministic:
 *
 *    tool_result   strip invisible Unicode / ANSI, splice out human-invisible
 *                  HTML, flag exfil-shaped URLs — before the model reads it
 *    input         vet prompts arriving from a human, an API, or another agent
 *    message_end   strip hidden bytes out of the agent's own replies
 *    tool_call     re-anchor edits composed against the sanitized view
 *
 *  Nothing here classifies text as malicious. It only makes the model's view
 *  of a byte stream match the human's, which is the property the whole
 *  hidden-content class of injections depends on breaking.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isEditInput, repairEdit } from "./edit-repair.js";
import { sanitizeAssistantMessage, type MessageLike } from "./egress.js";
import { sanitizeToolResult, suppressedContent, type ContentPart } from "./ingress.js";
import { classifyInput } from "./input.js";
import { describePolicy, resolvePolicy } from "./policy.js";
import { createStats, describeStats } from "./stats.js";

/** Writing to stdout would corrupt a TUI, so the log is for the non-interactive
 *  case: a server or CI run where stderr is a file someone greps later.
 *  `PI_SANITIZER_DEBUG=1` forces it on. */
function createLogger(): (message: string) => void {
  const debug = Boolean(process.env.PI_SANITIZER_DEBUG);
  const quiet = process.stdout.isTTY && !debug;
  if (quiet) return () => {};
  return (message: string) => console.error(`[pi-sanitizer] ${message}`);
}

export default function (pi: ExtensionAPI) {
  const { policy, warnings } = resolvePolicy();
  const stats = createStats();
  const log = createLogger();

  for (const warning of warnings) log(warning);
  log(describePolicy(policy));

  const showStatus = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus("pi-sanitizer", `sanitizer: ${describeStats(stats)}`);
  };

  // --- Ingress: tool output ------------------------------------------------

  pi.on("tool_result", async (event, ctx) => {
    if (!policy.enabled || !policy.ingress) return;
    try {
      const result = await sanitizeToolResult(
        policy,
        event.toolName,
        event.content as ContentPart[],
      );
      if (!result) return;
      stats.toolResultsSanitized++;
      log(`${event.toolName}: ${result.warnings.join(" | ")}`);
      showStatus(ctx);
      return { content: result.content as typeof event.content };
    } catch (error) {
      // Fail closed. A sanitizer that threw has told us nothing about these
      // bytes, so showing them would be worse than showing nothing.
      log(`${event.toolName}: sanitization failed, suppressing output: ${String(error)}`);
      return {
        content: suppressedContent(event.toolName, error) as typeof event.content,
        isError: true,
      };
    }
  });

  // --- Input: prompts from humans, APIs, and other agents ------------------

  pi.on("input", async (event, ctx) => {
    if (!policy.enabled || policy.input === "off") return;
    const decision = classifyInput(policy, event.text);
    if (decision.action === "continue") return { action: "continue" as const };

    if (decision.action === "handled") {
      stats.promptsBlocked++;
      log(`prompt blocked (${event.source}): ${decision.reason}`);
      if (ctx.hasUI) {
        ctx.ui.notify(
          `pi-sanitizer blocked a prompt carrying hidden characters. ${decision.reason}`,
          "error",
        );
      }
      showStatus(ctx);
      return { action: "handled" as const };
    }

    stats.promptsCleaned++;
    log(`prompt cleaned (${event.source})${decision.reason ? `: ${decision.reason}` : ""}`);
    showStatus(ctx);
    return { action: "transform" as const, text: decision.text, images: event.images };
  });

  // --- Egress: the agent's own replies -------------------------------------

  pi.on("message_end", (event, ctx) => {
    if (!policy.enabled || !policy.egress) return;
    const result = sanitizeAssistantMessage(event.message as unknown as MessageLike);
    if (!result) return;
    stats.messagesStripped++;
    log(`stripped from own reply: ${result.found.join(", ")}`);
    showStatus(ctx);
    return { message: result.message as unknown as typeof event.message };
  });

  // --- Edit repair: back from the sanitized view onto disk ------------------

  pi.on("tool_call", async (event, ctx) => {
    if (!policy.enabled || !policy.editRepair) return;
    if (event.toolName !== "edit" || !isEditInput(event.input)) return;

    let outcome;
    try {
      outcome = await repairEdit(event.input, ctx.cwd);
    } catch (error) {
      // Unlike ingress, failing closed here would block a legitimate edit on
      // a file that has nothing hidden in it. The edit tool's own exact-match
      // is the backstop: an unrepaired edit fails loudly, it does not write
      // the wrong bytes.
      log(`edit repair failed, leaving the call unchanged: ${String(error)}`);
      return;
    }

    if (outcome.action === "deny") {
      stats.editsDenied++;
      log(`edit denied: ${outcome.reason}`);
      showStatus(ctx);
      return { block: true, reason: `[pi-sanitizer] ${outcome.reason}` };
    }
    if (outcome.action === "repaired") {
      stats.editsRepaired++;
      log(`edit re-anchored: ${outcome.notes.join(" | ")}`);
      // `event.input` is pi's documented mutation seam for patching arguments.
      event.input.edits = outcome.edits;
      showStatus(ctx);
    }
  });

  // --- Status ---------------------------------------------------------------

  pi.registerCommand("sanitizer", {
    description: "Show pi-sanitizer's policy and what it has caught",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`pi-sanitizer: ${describePolicy(policy)} — ${describeStats(stats)}`, "info");
    },
  });
}
