import assert from "node:assert/strict";
import test from "node:test";
import { sendWithHttpProvider } from "../netlify/functions/outbound-worker.mjs";

const account = {
  id: "account-1",
  name: "Zespół obsługi",
  from_name: "MailFlow Support",
  from_email: "support@example.com",
  reply_to: "reply@example.com",
};

const recipient = {
  id: "recipient-1",
  email: "customer@example.com",
  name: "Jan Kowalski",
};

const content = {
  subject: "Status zgłoszenia",
  text: "Treść tekstowa",
  html: "<p>Treść HTML</p>",
};

test("Resend request contains idempotency, sender and both content variants", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ id: "resend-message-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await sendWithHttpProvider(
      { ...account, provider: "resend" },
      { apiKey: "re_test_key" },
      recipient,
      content,
    );
    const body = JSON.parse(request.init.body);

    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.init.headers.authorization, "Bearer re_test_key");
    assert.equal(
      request.init.headers["idempotency-key"],
      "mailflow/recipient-1",
    );
    assert.deepEqual(body.to, ["customer@example.com"]);
    assert.equal(body.from, "MailFlow Support <support@example.com>");
    assert.equal(body.reply_to, "reply@example.com");
    assert.equal(body.subject, content.subject);
    assert.equal(body.text, content.text);
    assert.equal(body.html, content.html);
    assert.deepEqual(result, { messageId: "resend-message-1" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SendGrid request uses Mail Send v3 schema and provider response ID", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return new Response(null, {
      status: 202,
      headers: { "x-message-id": "sendgrid-message-1" },
    });
  };

  try {
    const result = await sendWithHttpProvider(
      { ...account, provider: "sendgrid" },
      { api_key: "SG.test-key" },
      recipient,
      content,
    );
    const body = JSON.parse(request.init.body);

    assert.equal(request.url, "https://api.sendgrid.com/v3/mail/send");
    assert.equal(request.init.headers.authorization, "Bearer SG.test-key");
    assert.deepEqual(body.personalizations, [
      {
        to: [{ email: "customer@example.com", name: "Jan Kowalski" }],
      },
    ]);
    assert.deepEqual(body.from, {
      email: "support@example.com",
      name: "MailFlow Support",
    });
    assert.deepEqual(body.reply_to, { email: "reply@example.com" });
    assert.deepEqual(body.content, [
      { type: "text/plain", value: "Treść tekstowa" },
      { type: "text/html", value: "<p>Treść HTML</p>" },
    ]);
    assert.deepEqual(result, { messageId: "sendgrid-message-1" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HTTP adapter rejects providers outside the explicit allowlist", async () => {
  await assert.rejects(
    sendWithHttpProvider(
      { ...account, provider: "unknown" },
      { apiKey: "test" },
      recipient,
      content,
    ),
    /not implemented/,
  );
});
