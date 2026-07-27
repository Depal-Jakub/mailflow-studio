import assert from "node:assert/strict";
import test from "node:test";
import {
  API_KEY_PREFIX,
  API_SCOPES,
  clientIp,
  encodeCursor,
  extractApiKey,
  generateApiKey,
  hashApiKey,
  normalizeApiScopes,
  parseCursor,
  validateAllowedIps,
  validateExpiry,
} from "../netlify/functions/_shared/api-keys.mjs";

test("generated API keys are random, prefixed and stored as SHA-256 only", () => {
  const first = generateApiKey();
  const second = generateApiKey();

  assert.match(first.secret, /^mfs_live_[A-Za-z0-9_-]{40,}$/);
  assert.equal(first.prefix, first.secret.slice(0, API_KEY_PREFIX.length + 10));
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.equal(first.hash, hashApiKey(first.secret));
  assert.notEqual(first.secret, second.secret);
  assert.notEqual(first.hash, second.hash);
});

test("scope normalization rejects unknown scopes and removes duplicates", () => {
  assert.deepEqual(
    normalizeApiScopes([
      "messages:read",
      "unknown:write",
      "messages:read",
      "sources:sync",
    ]),
    ["messages:read", "sources:sync"],
  );
  assert.deepEqual(normalizeApiScopes(["*", ...API_SCOPES]), ["*"]);
  assert.deepEqual(normalizeApiScopes("messages:read"), []);
});

test("API key extraction supports bearer and X-API-Key headers", () => {
  assert.equal(
    extractApiKey({ authorization: "Bearer mfs_live_example" }),
    "mfs_live_example",
  );
  assert.equal(
    extractApiKey({ "X-API-Key": " mfs_live_direct " }),
    "mfs_live_direct",
  );
  assert.equal(extractApiKey({ authorization: "Basic abc" }), "");
});

test("cursor encoding is opaque, reversible and rejects malformed values", () => {
  const timestamp = "2026-07-27T15:00:00.000Z";
  const id = "df431fc1-d235-45b8-a3f0-6f0126e9779b";
  const encoded = encodeCursor(timestamp, id);

  assert.notEqual(encoded, timestamp);
  assert.deepEqual(parseCursor(encoded), { timestamp, id });
  assert.deepEqual(
    parseCursor(
      Buffer.from(JSON.stringify({ timestamp })).toString("base64url"),
    ),
    { timestamp, id: null },
  );
  assert.equal(parseCursor("not-a-cursor"), null);
  assert.equal(
    parseCursor(
      Buffer.from(JSON.stringify({ timestamp: "not-a-date" })).toString(
        "base64url",
      ),
    ),
    null,
  );
});

test("client IP uses trusted Netlify header before forwarded values", () => {
  assert.equal(
    clientIp({
      "x-nf-client-connection-ip": "203.0.113.8",
      "x-forwarded-for": "198.51.100.10, 198.51.100.11",
    }),
    "203.0.113.8",
  );
  assert.equal(
    clientIp({ "x-forwarded-for": "198.51.100.10, 198.51.100.11" }),
    "198.51.100.10",
  );
});

test("IP allowlists and expiration values are validated before database writes", () => {
  assert.deepEqual(validateAllowedIps(["203.0.113.8", "2001:db8::/32"]), [
    "203.0.113.8",
    "2001:db8::/32",
  ]);
  assert.throws(() => validateAllowedIps(["example.com"]));
  assert.throws(() => validateAllowedIps(Array.from({ length: 51 }, () => "::1")));

  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(validateExpiry(future), future);
  assert.equal(validateExpiry(""), null);
  assert.throws(() => validateExpiry("2020-01-01T00:00:00.000Z"));
  assert.throws(() => validateExpiry("not-a-date"));
});
