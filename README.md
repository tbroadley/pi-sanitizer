# pi-sanitizer

A [pi](https://pi.dev) extension that keeps the bytes an agent reads the same as
the bytes a human would see.

Hidden-content prompt injection does not need a clever jailbreak. It needs a
channel the operator's eyes skip and the model's tokenizer does not: an HTML
comment in a fetched page, a zero-width run inside a diff, an ANSI escape that
paints instructions the same colour as the background, a Cyrillic `а` in a
command. `pi-sanitizer` closes those channels with deterministic byte-level
transforms — no classifier, no second model, nothing to prompt-inject in turn.

It wraps [`agent-sanitizer`](https://github.com/AlexanderMattTurner/agent-sanitizer),
which owns the Unicode tables and the offset machinery, and wires it onto pi's
extension events.

## Install

```sh
pi install git:github.com/tbroadley/pi-sanitizer
```

Try it for one run without installing:

```sh
pi -e git:github.com/tbroadley/pi-sanitizer
```

Anything that embeds the pi agent — a server running long-lived agents, a CI
job, a harness — picks it up from `~/.pi/agent/settings.json` too, so one
install covers every agent on the host.

## What it does

| Seam | Event | Behaviour |
| --- | --- | --- |
| Ingress | `tool_result` | Strips invisible Unicode and ANSI/terminal escapes, splices out human-invisible HTML (comments, `display:none`, off-screen, white-on-white) leaving a placeholder, and flags exfil-shaped URLs. The finding is appended as its own content part. |
| Input | `input` | Vets prompts — from a person, an API, or another agent — for payload-capable hidden bytes. Cleans and flags them by default; can drop them instead. |
| Egress | `message_end` | Strips hidden bytes out of the agent's *own* replies, so it cannot signal past a human reader, a monitor, or the next agent it hands off to. |
| Edit repair | `tool_call` | Re-anchors an `edit` composed against the sanitized view back onto the real bytes on disk. |

### Why edit repair is the load-bearing part

Sanitizing a file read makes the model's view of that file diverge from its
bytes. An `edit` whose `oldText` was copied out of the clean view then fails
exact-match against the real file — the agent gets "oldText not found" for text
it is looking straight at, and usually responds by rewriting the region blind.

So the model works in a lifted space. It reads the sanitized view, composes an
edit against it, and the extension maps the edit back onto the real bytes before
the tool runs — invisible characters inside the replaced span go with it,
untouched runs outside it stay put. Ambiguity is denied rather than guessed: if
a span could map to more than one place on disk, the call is blocked with a
reason telling the agent how to make it unique, because silently picking one
occurrence is exactly the outcome an invisible-character trap is fishing for.

Two deliberate carve-outs keep that mapping honest:

- **File reads get Layer 1 only.** Stripped invisible runs are re-anchorable; an
  HTML splice replaces bytes with a placeholder that nothing can map back. If
  the HTML layer ran on `read`, an agent opening `index.html` would see
  `[HTML comment removed]` and could never edit that region again. Ordinary
  tool output — fetched pages, command output — gets the full stack.
- **Egress leaves `thinking` and `toolCall` parts alone.** Providers sign
  reasoning blocks and reject a context whose signature no longer matches, and
  tool arguments have already been dispatched by the time the message is
  finalized. Hidden bytes an agent writes into a *file* are caught on the way
  back in, when something reads that file.

## Configuration

Everything is on by default. Each layer has its own switch because each has a
different failure mode.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PI_SANITIZER` | `on` | Master switch. `off` makes every handler inert. |
| `PI_SANITIZER_INGRESS` | `on` | Sanitize tool output. |
| `PI_SANITIZER_HTML` | `on` | Splice human-invisible HTML out of non-file tool output. |
| `PI_SANITIZER_EXFIL` | `on` | Report exfil-shaped URLs. |
| `PI_SANITIZER_SKIP_TOOLS` | — | Comma-separated tool names to leave alone. |
| `PI_SANITIZER_INPUT` | `note` | `note` cleans and flags a poisoned prompt, `block` drops it, `off` disables the check. |
| `PI_SANITIZER_EGRESS` | `on` | Strip hidden bytes from the agent's replies. |
| `PI_SANITIZER_EDIT_REPAIR` | `on` | Re-anchor edits onto disk bytes. |
| `PI_SANITIZER_DEBUG` | — | Log to stderr even in a TUI. |

`/sanitizer` reports the effective policy and what has been caught so far.

## Failure behaviour

- **Ingress fails closed.** A sanitizer that threw has told us nothing about the
  bytes it was handed, so the output is suppressed rather than shown unvetted.
- **Edit repair fails open.** Blocking there would stop a legitimate edit to a
  file with nothing hidden in it, and the edit tool's own exact-match is the
  backstop: an unrepaired edit fails loudly, it never writes the wrong bytes.
- **A bad config value is warned about and ignored.** A typo in an environment
  variable must not stop an agent from starting, and must not silently disable
  the sanitizer either.

## What it is not

Not a jailbreak detector, not a semantic filter, not a secret redactor. It has a
seam for a redaction engine (`agent-sanitizer` supports one) that is currently
wired to a no-op. It only guarantees that what the model reads is what you would
read, which is the assumption every hidden-content injection is built on
breaking.

## Development

```sh
npm install
npm test
npm run typecheck
```

## License

MIT
