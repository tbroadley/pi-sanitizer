import { describe, expect, it } from "vitest";
import { applyLayer1 } from "agent-sanitizer";
import { isEditInput, repairEdit } from "../src/edit-repair.js";

/** What the model would have seen after ingress sanitized the read. */
const view = (disk: string) => applyLayer1(disk).cleaned;

const reader = (contents: string) => () => contents;

describe("repairEdit", () => {
  it("does nothing when the file has nothing hidden in it", async () => {
    const disk = "const a = 1;\n";
    const outcome = await repairEdit(
      { path: "a.ts", edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }] },
      "/repo",
      reader(disk),
    );
    expect(outcome).toEqual({ action: "unchanged" });
  });

  it("re-anchors an edit composed against the sanitized view", async () => {
    const disk = "const a = 1;\nconst b\u200b = 2; // \u001b[31mhi\u001b[0m\nconst c = 3;\n";
    expect(view(disk)).toContain("const b = 2; // hi");

    const outcome = await repairEdit(
      {
        path: "a.ts",
        edits: [{ oldText: "const b = 2; // hi", newText: "const b = 22; // hi" }],
      },
      "/repo",
      reader(disk),
    );

    expect(outcome.action).toBe("repaired");
    if (outcome.action !== "repaired") return;
    // The rewritten oldText is what is actually on disk, invisible bytes and all.
    expect(outcome.edits[0].oldText).toContain("\u200b");
    expect(disk).toContain(outcome.edits[0].oldText);
    expect(outcome.edits[0].newText).toBe("const b = 22; // hi");
  });

  it("leaves the clean entries of a mixed call untouched", async () => {
    const disk = "let x\u200b = 1;\nlet y = 2;\n";
    const outcome = await repairEdit(
      {
        path: "a.ts",
        edits: [
          { oldText: "let x = 1;", newText: "let x = 10;" },
          { oldText: "let y = 2;", newText: "let y = 20;" },
        ],
      },
      "/repo",
      reader(disk),
    );
    expect(outcome.action).toBe("repaired");
    if (outcome.action !== "repaired") return;
    expect(outcome.edits[1]).toEqual({ oldText: "let y = 2;", newText: "let y = 20;" });
  });

  it("denies rather than guesses when a span is ambiguous on disk", async () => {
    // Two lines that look identical in the model's view but differ on disk:
    // picking one would be picking blind.
    const disk = "value = 1;\nvalue\u200b = 1;\n";
    const outcome = await repairEdit(
      { path: "a.ts", edits: [{ oldText: "value = 1;", newText: "value = 2;" }] },
      "/repo",
      reader(disk),
    );
    expect(outcome.action).toBe("deny");
    if (outcome.action !== "deny") return;
    expect(outcome.reason).toMatch(/occurrence|separately|locations/i);
    // Told in pi's vocabulary, not the library's Claude-shaped one.
    expect(outcome.reason).toContain("oldText");
    expect(outcome.reason).not.toContain("old_string");
  });

  it("passes an unreadable path through for the edit tool to complain about", async () => {
    const outcome = await repairEdit(
      { path: "missing.ts", edits: [{ oldText: "a", newText: "b" }] },
      "/repo",
      () => {
        throw new Error("ENOENT");
      },
    );
    expect(outcome).toEqual({ action: "unchanged" });
  });
});

describe("isEditInput", () => {
  it("accepts pi's edit shape and rejects everything else", () => {
    expect(isEditInput({ path: "a.ts", edits: [{ oldText: "a", newText: "b" }] })).toBe(true);
    expect(isEditInput({ path: "a.ts", edits: [{ oldText: "a" }] })).toBe(false);
    expect(isEditInput({ path: "a.ts" })).toBe(false);
    expect(isEditInput(null)).toBe(false);
  });
});
