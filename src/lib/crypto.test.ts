import { test } from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt, maskSecret } from "./crypto";

test("encrypt/decrypt round-trips a secret", () => {
  const secret = "github_pat_11ABCDEFG_supersecrettoken";
  const encrypted = encrypt(secret);
  assert.notEqual(encrypted, secret, "ciphertext must differ from plaintext");
  assert.equal(encrypted.split(":").length, 3, "format is iv:tag:ciphertext");
  assert.equal(decrypt(encrypted), secret, "round-trip returns original");
});

test("encryption is non-deterministic (random IV)", () => {
  const secret = "same-input";
  assert.notEqual(encrypt(secret), encrypt(secret), "same input, different ciphertext");
});

test("tampered ciphertext fails authentication", () => {
  const encrypted = encrypt("sensitive");
  const [iv, tag, data] = encrypted.split(":");
  const flipped = data.slice(0, -2) + (data.slice(-2) === "AA" ? "BB" : "AA");
  assert.throws(() => decrypt([iv, tag, flipped].join(":")));
});

test("maskSecret reveals only the last 4 chars", () => {
  assert.equal(maskSecret("abcdefghij"), "••••••••ghij");
  assert.equal(maskSecret("ab"), "••••");
});
