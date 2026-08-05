import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, describePolicy, resolvePolicy } from "../src/policy.js";

describe("resolvePolicy", () => {
  it("defaults to everything on", () => {
    const { policy, warnings } = resolvePolicy({});
    expect(warnings).toEqual([]);
    expect(policy).toEqual(DEFAULT_POLICY);
  });

  it("reads the off switches", () => {
    const { policy } = resolvePolicy({
      PI_SANITIZER_INGRESS: "off",
      PI_SANITIZER_HTML: "0",
      PI_SANITIZER_EGRESS: "false",
      PI_SANITIZER_EDIT_REPAIR: "no",
      PI_SANITIZER_INPUT: "block",
    });
    expect(policy.ingress).toBe(false);
    expect(policy.html).toBe(false);
    expect(policy.egress).toBe(false);
    expect(policy.editRepair).toBe(false);
    expect(policy.input).toBe("block");
  });

  it("parses a skip list", () => {
    const { policy } = resolvePolicy({ PI_SANITIZER_SKIP_TOOLS: "bash, my_tool ," });
    expect([...policy.skipTools]).toEqual(["bash", "my_tool"]);
  });

  it("warns about a bad value instead of failing, and keeps the default", () => {
    const { policy, warnings } = resolvePolicy({
      PI_SANITIZER_EGRESS: "maybe",
      PI_SANITIZER_INPUT: "loud",
    });
    expect(policy.egress).toBe(true);
    expect(policy.input).toBe("note");
    expect(warnings).toHaveLength(2);
    expect(warnings.join("\n")).toContain("PI_SANITIZER_EGRESS");
    expect(warnings.join("\n")).toContain("PI_SANITIZER_INPUT");
  });

  it("treats a falsy input mode as off", () => {
    expect(resolvePolicy({ PI_SANITIZER_INPUT: "0" }).policy.input).toBe("off");
  });

  it("describes the master switch plainly", () => {
    const { policy } = resolvePolicy({ PI_SANITIZER: "off" });
    expect(describePolicy(policy)).toContain("disabled");
  });
});
