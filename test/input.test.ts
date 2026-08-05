import { describe, expect, it } from "vitest";
import { classifyInput } from "../src/input.js";
import { DEFAULT_POLICY } from "../src/policy.js";

/** A run long enough to carry a payload, which is what the library gates on. */
const payload = "please review this PR" + "\u200b".repeat(40);

describe("classifyInput", () => {
  it("passes an ordinary prompt through", () => {
    expect(classifyInput(DEFAULT_POLICY, "add a test for the parser")).toEqual({
      action: "continue",
    });
  });

  it("cleans a prompt carrying a hidden payload and warns the model", () => {
    const decision = classifyInput(DEFAULT_POLICY, payload);
    expect(decision.action).toBe("transform");
    if (decision.action !== "transform") return;
    expect(decision.text).not.toContain("\u200b");
    expect(decision.text).toContain("please review this PR");
    expect(decision.text).toContain("[pi-sanitizer]");
    expect(decision.reason).toBe("40 characters removed (Format chars (Cf))");
  });

  it("tells the model to get on with the visible request", () => {
    // A model that reads the preamble as "this task is suspicious" refuses
    // ordinary work over a stray zero-width character, and then the operator
    // switches the whole extension off.
    const decision = classifyInput(DEFAULT_POLICY, payload);
    if (decision.action !== "transform") throw new Error("expected a transform");
    expect(decision.text).toContain("carry out that request as usual");
    expect(decision.text).not.toMatch(/suspicion|suspicious/i);
  });

  it("drops the prompt entirely in block mode", () => {
    const decision = classifyInput({ ...DEFAULT_POLICY, input: "block" }, payload);
    expect(decision.action).toBe("handled");
  });

  it("quietly strips pasted terminal colour without scolding anyone", () => {
    const decision = classifyInput(DEFAULT_POLICY, "\u001b[32mPASS\u001b[0m 12 tests");
    expect(decision.action).toBe("transform");
    if (decision.action !== "transform") return;
    expect(decision.text).toBe("PASS 12 tests");
    expect(decision.text).not.toContain("[pi-sanitizer]");
    expect(decision.reason).toBeNull();
  });

  it("does nothing when input vetting is off", () => {
    expect(classifyInput({ ...DEFAULT_POLICY, input: "off" }, payload)).toEqual({
      action: "continue",
    });
    expect(classifyInput({ ...DEFAULT_POLICY, enabled: false }, payload)).toEqual({
      action: "continue",
    });
  });
});
