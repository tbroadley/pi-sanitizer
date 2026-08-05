import { describe, expect, it } from "vitest";
import { sanitizeAssistantMessage } from "../src/egress.js";

describe("sanitizeAssistantMessage", () => {
  it("leaves a clean reply alone", () => {
    const message = { role: "assistant", content: [{ type: "text", text: "done" }] };
    expect(sanitizeAssistantMessage(message)).toBeUndefined();
  });

  it("strips a hidden channel out of the agent's own text", () => {
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "looks fine to me\u200b\u200b\u200b" }],
    };
    const result = sanitizeAssistantMessage(message);
    expect(result).toBeDefined();
    expect((result!.message.content as Array<{ text: string }>)[0].text).toBe("looks fine to me");
    expect(result!.found).toContain("cf-format");
  });

  it("does not touch thinking blocks, whose signatures must survive", () => {
    const thinking = { type: "thinking", thinking: "hmm\u200b", signature: "sig" };
    const message = {
      role: "assistant",
      content: [thinking, { type: "text", text: "hi\u200b" }],
    };
    const result = sanitizeAssistantMessage(message);
    expect((result!.message.content as unknown[])[0]).toBe(thinking);
  });

  it("does not touch tool calls, which have already been dispatched", () => {
    const toolCall = { type: "toolCall", id: "1", name: "bash", arguments: { command: "ls\u200b" } };
    const message = { role: "assistant", content: [toolCall, { type: "text", text: "x\u200b" }] };
    const result = sanitizeAssistantMessage(message);
    expect((result!.message.content as unknown[])[0]).toBe(toolCall);
  });

  it("ignores messages that are not from the assistant", () => {
    const message = { role: "user", content: [{ type: "text", text: "hi\u200b" }] };
    expect(sanitizeAssistantMessage(message)).toBeUndefined();
  });

  it("ignores a string-shaped content payload", () => {
    expect(sanitizeAssistantMessage({ role: "assistant", content: "hi\u200b" })).toBeUndefined();
  });
});
