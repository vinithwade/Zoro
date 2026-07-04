import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSlackMessage,
  cleanText,
  messageImportance,
  type SlackNormalizedEvent,
} from "./normalize";
import type { SlackMessage } from "./client";

const users = new Map([
  ["U1", "wade"],
  ["U2", "priya"],
]);
const channel = { id: "C123", name: "eng" };
const url = "https://acme.slack.com/";

function msg(p: Partial<SlackMessage> & Pick<SlackMessage, "ts">): SlackMessage {
  return { type: "message", user: "U1", text: "hello", ...p };
}

test("cleanText resolves mentions and links", () => {
  assert.equal(cleanText("hey <@U2> see <http://x.com|the docs>", users), "hey @priya see the docs");
  assert.equal(cleanText("go to <#C9|general>", users), "go to #general");
});

test("messageImportance flags blocker language", () => {
  assert.equal(messageImportance("the deploy is broken and blocked"), 3);
  assert.equal(messageImportance("nice work everyone"), 1);
});

test("normal message becomes a communication event", () => {
  const e = normalizeSlackMessage(channel, msg({ ts: "1720000000.000100", text: "shipping the new nav" }), users, "BOT", url) as SlackNormalizedEvent;
  assert.equal(e.source, "slack");
  assert.equal(e.department, "communication");
  assert.equal(e.type, "slack.message");
  assert.equal(e.sourceId, "slack:msg:C123:1720000000.000100");
  assert.equal(e.entityRef, "#eng");
  assert.equal(e.actor, "wade");
  assert.equal(e.importance, 1);
  assert.match(e.entityUrl!, /archives\/C123\/p1720000000000100$/);
});

test("blocker-language message is high importance", () => {
  const e = normalizeSlackMessage(channel, msg({ ts: "1.0", text: "CI is broken, I'm blocked" }), users, "BOT", url)!;
  assert.equal(e.importance, 3);
});

test("bot messages, subtypes, and the bot's own posts are skipped", () => {
  assert.equal(normalizeSlackMessage(channel, msg({ ts: "1", bot_id: "B1" }), users, "BOT", url), null);
  assert.equal(normalizeSlackMessage(channel, msg({ ts: "1", subtype: "channel_join" }), users, "BOT", url), null);
  assert.equal(normalizeSlackMessage(channel, msg({ ts: "1", user: "BOT" }), users, "BOT", url), null);
  assert.equal(normalizeSlackMessage(channel, msg({ ts: "1", text: "" }), users, "BOT", url), null);
});
