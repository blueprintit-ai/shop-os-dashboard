import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLicense, validateLicense } from "../src/license.js";

function withTempLicense(record, fn) {
  const dir = mkdtempSync(join(tmpdir(), "shopos-test-"));
  const path = join(dir, "license.json");
  writeFileSync(path, JSON.stringify(record));
  try {
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("readLicense returns null when file is missing", () => {
  assert.equal(readLicense("/no/such/path.json"), null);
});

test("readLicense parses a valid JSON file", () => {
  withTempLicense({ key: "SHOP-X", customer: "Acme" }, (path) => {
    const lic = readLicense(path);
    assert.equal(lic.key, "SHOP-X");
    assert.equal(lic.customer, "Acme");
  });
});

test("validateLicense accepts a valid Foundation license", () => {
  const result = validateLicense({
    key: "SHOP-X",
    entitlements: ["foundation"],
    valid_until: null,
  });
  assert.equal(result.ok, true);
});

test("validateLicense rejects a missing license", () => {
  const result = validateLicense(null);
  assert.equal(result.ok, false);
  assert.match(result.error, /not found/i);
});

test("validateLicense rejects an expired license", () => {
  const result = validateLicense({
    key: "SHOP-X",
    entitlements: ["foundation"],
    valid_until: "2020-01-01T00:00:00Z",
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /expired/i);
});

test("validateLicense rejects a license without foundation entitlement", () => {
  const result = validateLicense({
    key: "SHOP-X",
    entitlements: ["other"],
    valid_until: null,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /entitlement/i);
});
