# ADR: headless skill runner

Decision: `src/runs.js` invokes skills via `runTurn()` / Agent SDK `query()`,
passing `/<skillId> <input>` as the prompt, `permissionMode: "acceptEdits"`,
`settingSources: ["user","project"]`, `skills: "all"`. No child process is
spawned; this removes the shell-escaping risk present in the reference kit's
runner (`shellDQuoteEscape`, `spawn(cmdline, {shell:true})`).

Fallback (only if the spike above fails on the target Claude Code version):
`spawn("claude", ["-p", prompt, "--model", modelId, "--permission-mode", "acceptEdits"], {cwd: vaultPath})`
— an argument array, `shell` omitted (defaults to `false`), no template string,
no `--effort` flag (effort becomes a one-line instruction folded into the prompt
instead, since the real CLI has no such flag — that flag only ever existed in
the reference kit's own bespoke runner script).

Spike run on: 2026-09-06. Result: the spike command from the brief was run
verbatim (see transcript below) against the Claude Agent SDK available in
this implementation sandbox. It did **not** hit a real, fully signed-in
Claude Code account with a live model — the `system/init` and `assistant`
events came back with `"model":"<synthetic>"`, meaning this sandbox's SDK
session is backed by a synthetic/test double rather than a live Sonnet/Opus
call. So this is not the "real signed-in Claude Code install" the brief
asked for, and the skill-specific behavior of `/bp-digest` etc. against a
real model remains unverified here.

What it *does* confirm, directly and mechanically: `query({ prompt: "/help",
options: { cwd, maxTurns: 3, permissionMode: "acceptEdits", settingSources:
["user","project"] } })` did not throw, did not reject the prompt string, and
produced a normal, well-formed event stream — `system/init`, an `assistant`
message, and a terminal `result` event with `is_error:false`:

```
EVENT: {"type":"system","subtype":"init","cwd":"...","session_id":"6dfec445-..."}
EVENT: {"type":"assistant","message":{... "model":"<synthetic>", "role":"assistant", "stop_reason":"end_turn", ...}}
EVENT: {"is_error":false,"duration_api_ms":0,"num_turns":0,"stop_reason":null,"session_id":"6dfec445-...","total_cost_usd":0, ...}
RESULT: /help isn't available in this environment.
```

That is: `query()` accepted a `/slashCommand` string as `prompt` the same
way the interactive CLI does, ran it through the normal turn machinery
(init → assistant → result), and returned a clean textual result rather than
throwing a validation error or rejecting the promise/generator. The literal
reply text ("/help isn't available in this environment.") is itself just the
synthetic model's answer to that particular slash command in this sandbox —
not a rejection of slash-command prompts as a mechanism.

Combined with the documented design reasoning — Shop OS Chat's own
owner-chat flow already passes free-text prompts through the identical
`runTurn()` / `buildQueryOptions` pattern with `settingSources:
["user","project"], skills:"all"` (see `src/chat/options.js`), and a
`/slashCommand` string is just another string prompt to that same pipe —
this is treated as sufficient to proceed with the SDK-based design exactly
as specified, with the caveat that this sandbox could not exercise a real
skill (e.g. `/bp-digest`) against a live model. Full end-to-end confirmation
(a real skill producing real skill output) is deferred to Task 7 Step 9's
manual verification or Task 14's Playwright pass, as anticipated.
