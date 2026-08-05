/** Edit repair: let the model work in the sanitized view and still hit disk.
 *
 *  Sanitizing a file read makes the model's view of that file diverge from
 *  its bytes. An `edit` whose `oldText` was copied from the clean view then
 *  fails exact-match against the real file — the agent sees "oldText not
 *  found" on text it is looking straight at, and usually responds by
 *  rewriting the region blind.
 *
 *  So the model operates in a lifted space: it reads the sanitized view,
 *  composes an edit against it, and this module maps that edit back onto the
 *  real bytes before the tool runs. `agent-sanitizer/rehydrate` owns the
 *  interesting half (locating the span in the re-derived view and mapping it
 *  across stripped runs); this file is the adapter between pi's edit shape
 *  (`{path, edits: [{oldText, newText}]}`) and the Claude-shaped
 *  `{file_path, old_string, new_string}` the library takes.
 *
 *  Ambiguity is denied, never guessed. If a span could map to more than one
 *  place on disk, silently picking one would let an invisible-character trap
 *  steer an edit into a region the model never looked at.
 */

import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { rehydrateRedacted } from "agent-sanitizer/rehydrate";

export interface EditEntry {
  oldText: string;
  newText: string;
}

export interface EditInput {
  path: string;
  edits: EditEntry[];
}

export type RepairOutcome =
  | { action: "unchanged" }
  | { action: "repaired"; edits: EditEntry[]; notes: string[] }
  | { action: "deny"; reason: string };

/** File reader seam, so tests do not need a temp directory. */
export type ReadFile = (absolutePath: string) => string;

const defaultReadFile: ReadFile = (path) => readFileSync(path, "utf8");

/** The redactor seam `agent-sanitizer` exposes for secret redaction, wired to
 *  a no-op: this extension does not redact secrets, so the sanitized view and
 *  the disk bytes differ only by Layer 1. Wiring a real engine (detect-secrets
 *  or similar) here later is the whole extension point. */
function noRedaction() {
  return {
    redactMap: (text: string) => ({ text, pairs: [] as never[] }),
    redact: () => null,
  };
}

/** The library speaks Claude Code's field names. A pi agent reading a deny
 *  reason needs to be told which of *its* arguments to fix, so translate the
 *  vocabulary on the way out. */
export function inPiTerms(reason: string): string {
  return reason.replaceAll("old_string", "oldText").replaceAll("new_string", "newText");
}

export function isEditInput(input: unknown): input is EditInput {
  if (!input || typeof input !== "object") return false;
  const candidate = input as EditInput;
  return (
    typeof candidate.path === "string" &&
    Array.isArray(candidate.edits) &&
    candidate.edits.every(
      (edit) =>
        edit &&
        typeof edit === "object" &&
        typeof edit.oldText === "string" &&
        typeof edit.newText === "string",
    )
  );
}

/** Re-anchor every entry of one `edit` call.
 *
 *  Each entry is resolved against the file as it is on disk *now*, because
 *  that is the only state that exists when `tool_call` fires. For the usual
 *  case — several disjoint edits in one call — that is exactly right. An
 *  entry whose span only exists after an earlier entry has been applied
 *  simply does not resolve, and is passed through untouched for pi's own
 *  edit tool to report on.
 */
export async function repairEdit(
  input: EditInput,
  cwd: string,
  readFile: ReadFile = defaultReadFile,
): Promise<RepairOutcome> {
  const absolute = isAbsolute(input.path) ? input.path : resolve(cwd, input.path);

  let contents: string;
  try {
    contents = readFile(absolute);
  } catch {
    // Unreadable or missing: nothing to map onto. Let the edit tool fail with
    // its own, better-worded error.
    return { action: "unchanged" };
  }

  const io = { readFile: () => contents, ...noRedaction() };
  const edits: EditEntry[] = [];
  const notes: string[] = [];
  let repaired = false;

  for (const edit of input.edits) {
    const result = await rehydrateRedacted(
      "Edit",
      { file_path: input.path, old_string: edit.oldText, new_string: edit.newText },
      io,
    );
    if (!result) {
      edits.push(edit);
      continue;
    }
    if ("deny" in result) return { action: "deny", reason: inPiTerms(result.deny) };
    repaired = true;
    edits.push({
      oldText: result.updatedInput.old_string,
      newText: result.updatedInput.new_string,
    });
    notes.push(result.context);
  }

  return repaired ? { action: "repaired", edits, notes } : { action: "unchanged" };
}
