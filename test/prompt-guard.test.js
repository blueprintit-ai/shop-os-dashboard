import { test } from "node:test";
import assert from "node:assert/strict";
import { neutralizeMentions, neutralizeCommandPrefix, guardStaffPrompt } from "../src/chat/prompt-guard.js";

const Z = "​";

test("every @ that could start a mention gets a zero-width space after it", () => {
  assert.equal(neutralizeMentions("see @Resources/Private/hr.md"), `see @${Z}Resources/Private/hr.md`);
  assert.equal(neutralizeMentions("@a @b\n@c"), `@${Z}a @${Z}b\n@${Z}c`);
  assert.equal(neutralizeMentions('@"x y/z.md" @/etc/hosts @./a @~/b @../c'), `@${Z}"x y/z.md" @${Z}/etc/hosts @${Z}./a @${Z}~/b @${Z}../c`);
  assert.equal(neutralizeMentions("mail marco@example.com"), `mail marco@${Z}example.com`);
  assert.equal(neutralizeMentions("trailing @"), "trailing @");
  assert.equal(neutralizeMentions("@ alone"), "@ alone");
  assert.equal(neutralizeMentions("line @\r\nnext @x\r\n"), `line @\r\nnext @${Z}x\r\n`);
});

test("neutralizing twice changes nothing more, and an already zero-width @ is left alone", () => {
  const once = neutralizeMentions("@a/b @@c");
  assert.equal(neutralizeMentions(once), once);
  assert.equal(neutralizeMentions(`@${Z}x`), `@${Z}x`);
  assert.ok(!/@[^\s​]/.test(neutralizeMentions("@@c @d")));
});

test("a leading slash or bang is not left to be read as a command", () => {
  for (const p of ["/insights", "/context", "/init", "  /security-review", "\n/recap", "!ls", `${Z}/config`, "﻿/x", "/"]) {
    const out = neutralizeCommandPrefix(p);
    assert.ok(out.startsWith("Message from the user: "), p);
    assert.ok(out.endsWith(p));
  }
  for (const p of ["hello /insights", "what is 1/2?", "use ! for emphasis", "", "path a/b"]) assert.equal(neutralizeCommandPrefix(p), p);
});

test("guardStaffPrompt handles strings, content blocks and non-prompts", () => {
  assert.equal(guardStaffPrompt("/x @y"), `Message from the user: /x @${Z}y`);
  const blocks = [{ type: "text", text: "/a @b" }, { type: "image", source: { data: "@x" } }, { type: "text", text: "/c @d" }];
  const out = guardStaffPrompt(blocks);
  assert.equal(out[0].text, `Message from the user: /a @${Z}b`);
  assert.deepEqual(out[1], blocks[1], "non-text blocks are untouched");
  assert.equal(out[2].text, `/c @${Z}d`, "only the start of the message can be a command");
  assert.equal(blocks[0].text, "/a @b", "input not mutated");
  assert.equal(guardStaffPrompt(undefined), undefined);
  assert.equal(guardStaffPrompt(""), "");
});
