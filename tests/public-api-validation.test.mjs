import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMessagePatch } from "../netlify/functions/public-api.mjs";

test("message patch normalizes tags and accepts safe workflow fields", () => {
  const patch = normalizeMessagePatch({
    status: "review",
    score: 72,
    review_reason: "Wymaga decyzji operatora",
    category_id: "154d2f80-fd76-49d7-9cb0-e6ddb5e2f66a",
    review_assignee_id: null,
    tags: [" pilne ", "klient", "pilne"],
    ignored: "value",
  });

  assert.deepEqual(patch, {
    status: "review",
    score: 72,
    review_reason: "Wymaga decyzji operatora",
    category_id: "154d2f80-fd76-49d7-9cb0-e6ddb5e2f66a",
    review_assignee_id: null,
    tags: ["pilne", "klient"],
  });
});

test("message patch rejects worker-only statuses and invalid scores", () => {
  assert.throws(
    () => normalizeMessagePatch({ status: "processing" }),
    (error) => error.code === "invalid_status" && error.statusCode === 400,
  );
  assert.throws(
    () => normalizeMessagePatch({ score: -1 }),
    (error) => error.code === "invalid_score" && error.statusCode === 400,
  );
  assert.throws(
    () => normalizeMessagePatch({ score: 10.5 }),
    (error) => error.code === "invalid_score" && error.statusCode === 400,
  );
});

test("message patch rejects malformed cross-organization references", () => {
  assert.throws(
    () => normalizeMessagePatch({ category_id: "not-a-uuid" }),
    (error) => error.code === "invalid_reference" && error.statusCode === 400,
  );
  assert.throws(
    () => normalizeMessagePatch({ review_assignee_id: "" }),
    (error) => error.code === "invalid_reference" && error.statusCode === 400,
  );
});

test("message patch requires at least one supported field", () => {
  assert.throws(
    () => normalizeMessagePatch({ subject: "Nie można zmienić" }),
    (error) => error.code === "no_changes" && error.statusCode === 400,
  );
});
