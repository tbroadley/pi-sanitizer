/** Effective configuration for the sanitizer, resolved from the environment.
 *
 *  Everything is on by default: the point of the extension is that an operator
 *  installs it once and every agent it runs is covered. Each layer has its own
 *  off switch because each has a different failure mode, and one of them
 *  misbehaving should not cost you the others.
 */

export type InputMode = "off" | "note" | "block";

export interface SanitizerPolicy {
  /** Master switch. False means every handler returns immediately. */
  enabled: boolean;
  /** Sanitize tool output before the model reads it. */
  ingress: boolean;
  /** Splice human-invisible HTML (comments, `display:none`, ...) out of tool
   *  output. Never applied to file reads — see `HTML_EXEMPT_TOOLS`. */
  html: boolean;
  /** Report exfil-shaped URLs found in tool output. */
  exfilScan: boolean;
  /** Tool names whose output is left alone entirely. */
  skipTools: ReadonlySet<string>;
  /** What to do with a user prompt carrying payload-capable hidden bytes. */
  input: InputMode;
  /** Strip hidden bytes from the agent's own assistant messages. */
  egress: boolean;
  /** Re-anchor edits composed against the sanitized view onto disk bytes. */
  editRepair: boolean;
}

export const DEFAULT_POLICY: SanitizerPolicy = {
  enabled: true,
  ingress: true,
  html: true,
  exfilScan: true,
  skipTools: new Set<string>(),
  input: "note",
  egress: true,
  editRepair: true,
};

/** Tools whose output must stay byte-mappable to what is on disk.
 *
 *  Layer 1 deletions are re-anchorable (`agent-sanitizer/view-map` knows how
 *  to map a span back across them), but an HTML splice replaces bytes with a
 *  placeholder that nothing can map back. Applying it to a file read would
 *  mean an agent reading `index.html` sees `[HTML comment removed]` and can
 *  never edit that region again. So file reads get Layer 1 only. */
export const HTML_EXEMPT_TOOLS: ReadonlySet<string> = new Set(["read", "edit", "write"]);

/** Skip the (lazy-loaded, heavier) HTML pipeline past this many bytes. A
 *  page big enough to matter is nearly always machine-generated noise, and
 *  parsing it costs more than the injection risk it carries. */
export const HTML_MAX_BYTES = 512_000;

const TRUE_VALUES = new Set(["1", "true", "on", "yes", "enabled"]);
const FALSE_VALUES = new Set(["0", "false", "off", "no", "disabled"]);

export type Env = Record<string, string | undefined>;

function readBool(
  env: Env,
  name: string,
  fallback: boolean,
  warnings: string[],
): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  warnings.push(`ignoring ${name}=${JSON.stringify(raw)}: expected on/off`);
  return fallback;
}

function readInputMode(env: Env, warnings: string[]): InputMode {
  const raw = env.PI_SANITIZER_INPUT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_POLICY.input;
  const value = raw.trim().toLowerCase();
  if (value === "off" || value === "note" || value === "block") return value;
  if (FALSE_VALUES.has(value)) return "off";
  warnings.push(
    `ignoring PI_SANITIZER_INPUT=${JSON.stringify(raw)}: expected off | note | block`,
  );
  return DEFAULT_POLICY.input;
}

function readSkipTools(env: Env): ReadonlySet<string> {
  const raw = env.PI_SANITIZER_SKIP_TOOLS;
  if (!raw) return DEFAULT_POLICY.skipTools;
  return new Set(
    raw
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== ""),
  );
}

/** Build the effective policy. A bad value is warned about and ignored rather
 *  than throwing: a typo in an env var must not stop an agent from starting,
 *  and least of all must it silently disable the sanitizer. */
export function resolvePolicy(env: Env = process.env): {
  policy: SanitizerPolicy;
  warnings: string[];
} {
  const warnings: string[] = [];
  const enabled = readBool(env, "PI_SANITIZER", DEFAULT_POLICY.enabled, warnings);
  return {
    policy: {
      enabled,
      ingress: readBool(env, "PI_SANITIZER_INGRESS", DEFAULT_POLICY.ingress, warnings),
      html: readBool(env, "PI_SANITIZER_HTML", DEFAULT_POLICY.html, warnings),
      exfilScan: readBool(env, "PI_SANITIZER_EXFIL", DEFAULT_POLICY.exfilScan, warnings),
      skipTools: readSkipTools(env),
      input: readInputMode(env, warnings),
      egress: readBool(env, "PI_SANITIZER_EGRESS", DEFAULT_POLICY.egress, warnings),
      editRepair: readBool(
        env,
        "PI_SANITIZER_EDIT_REPAIR",
        DEFAULT_POLICY.editRepair,
        warnings,
      ),
    },
    warnings,
  };
}

/** One-line summary of what is switched on, for the startup log and the
 *  `/sanitizer` command. */
export function describePolicy(policy: SanitizerPolicy): string {
  if (!policy.enabled) return "disabled (PI_SANITIZER=off)";
  const parts = [
    `ingress=${policy.ingress ? (policy.html ? "layer1+html" : "layer1") : "off"}`,
    `input=${policy.input}`,
    `egress=${policy.egress ? "on" : "off"}`,
    `edit-repair=${policy.editRepair ? "on" : "off"}`,
  ];
  if (policy.skipTools.size > 0) parts.push(`skip=${[...policy.skipTools].join("/")}`);
  return parts.join(" ");
}
