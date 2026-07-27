import {
  adminClient,
  compactText,
  hmacHex,
  jsonResponse,
  normalizedEmail,
  sha256Hex,
} from "../_shared/runtime.ts";

type RecipientInput =
  | string
  | {
      email?: unknown;
      name?: unknown;
    };

type AttachmentInput = {
  externalId?: unknown;
  filename?: unknown;
  contentType?: unknown;
  sizeBytes?: unknown;
  storageBucket?: unknown;
  storagePath?: unknown;
  metadata?: unknown;
};

function normalizeRecipients(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 250)
    .map((recipient: RecipientInput) => {
      if (typeof recipient === "string") {
        const email = normalizedEmail(recipient);
        return email ? { email } : null;
      }

      const email = normalizedEmail(recipient?.email);
      if (!email) return null;
      const name = compactText(recipient?.name, 200);
      return name ? { email, name } : { email };
    })
    .filter(Boolean);
}

function normalizeAttachments(value: unknown): AttachmentInput[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object").slice(0, 100)
    : [];
}

async function authorized(request: Request, rawBody: string): Promise<boolean> {
  const workerSecret = Deno.env.get("WORKER_SECRET");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (workerSecret && bearer === workerSecret) return true;

  const signingSecret = Deno.env.get("INGEST_SIGNING_SECRET");
  const providedSignature = request.headers
    .get("x-mailflow-signature")
    ?.replace(/^sha256=/i, "");
  if (!signingSecret || !providedSignature) return false;

  const expectedSignature = await hmacHex(signingSecret, rawBody);
  if (expectedSignature.length !== providedSignature.length) return false;

  let difference = 0;
  for (let index = 0; index < expectedSignature.length; index += 1) {
    difference |=
      expectedSignature.charCodeAt(index) ^
      providedSignature.charCodeAt(index);
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const rawBody = await request.text();
    if (rawBody.length > 10_000_000) {
      return jsonResponse(413, { ok: false, error: "Payload too large" });
    }
    if (!(await authorized(request, rawBody))) {
      return jsonResponse(401, { ok: false, error: "Unauthorized" });
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const organizationId = compactText(payload.organizationId, 100);
    const sourceConnectorId = compactText(payload.sourceConnectorId, 100);
    const externalId = compactText(payload.externalId, 1000);
    const senderEmail = normalizedEmail(payload.senderEmail);
    const subject = compactText(payload.subject, 2000);
    const bodyText = compactText(payload.bodyText, 2_000_000);
    const bodyHtml = compactText(payload.bodyHtml, 4_000_000);
    const receivedAt = new Date(String(payload.receivedAt ?? ""));

    if (!organizationId || !senderEmail || Number.isNaN(receivedAt.getTime())) {
      return jsonResponse(400, {
        ok: false,
        error: "organizationId, senderEmail and valid receivedAt are required",
      });
    }

    const supabase = adminClient();
    if (sourceConnectorId) {
      const { data: source, error: sourceError } = await supabase
        .from("source_connectors")
        .select("id")
        .eq("id", sourceConnectorId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (sourceError) throw sourceError;
      if (!source) {
        return jsonResponse(400, {
          ok: false,
          error: "Source connector does not belong to the organization",
        });
      }
    }

    const dedupeHash = await sha256Hex(
      [
        organizationId,
        sourceConnectorId,
        externalId,
        senderEmail,
        receivedAt.toISOString(),
        subject,
      ].join("\u001f"),
    );

    const messageRow = {
      organization_id: organizationId,
      source_connector_id: sourceConnectorId || null,
      external_id: externalId || null,
      thread_id: compactText(payload.threadId, 1000) || null,
      direction: payload.direction === "outgoing" ? "outgoing" : "incoming",
      sender_email: senderEmail,
      sender_name: compactText(payload.senderName, 300) || null,
      recipients: normalizeRecipients(payload.recipients),
      subject,
      preview:
        compactText(payload.preview, 1000) ||
        bodyText.replace(/\s+/g, " ").slice(0, 500),
      body_text: bodyText || null,
      body_html: bodyHtml || null,
      headers:
        payload.headers &&
        typeof payload.headers === "object" &&
        !Array.isArray(payload.headers)
          ? payload.headers
          : {},
      received_at: receivedAt.toISOString(),
      status: "new",
      tags: Array.isArray(payload.tags)
        ? payload.tags
            .filter((tag): tag is string => typeof tag === "string")
            .map((tag) => tag.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 50)
        : [],
      dedupe_hash: dedupeHash,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("messages")
      .insert(messageRow)
      .select("id, status")
      .single();

    if (insertError?.code === "23505") {
      const { data: duplicate } = await supabase
        .from("messages")
        .select("id, status")
        .eq("organization_id", organizationId)
        .eq("dedupe_hash", dedupeHash)
        .maybeSingle();
      return jsonResponse(200, {
        ok: true,
        duplicate: true,
        message: duplicate,
      });
    }
    if (insertError) throw insertError;

    const attachments = normalizeAttachments(payload.attachments)
      .map((attachment) => {
        const filename = compactText(attachment.filename, 1000);
        if (!filename) return null;
        const size = Number.parseInt(String(attachment.sizeBytes ?? 0), 10);

        return {
          organization_id: organizationId,
          message_id: inserted.id,
          external_id: compactText(attachment.externalId, 1000) || null,
          filename,
          content_type: compactText(attachment.contentType, 300) || null,
          size_bytes: Number.isFinite(size) ? Math.max(0, size) : 0,
          storage_bucket: compactText(attachment.storageBucket, 300) || null,
          storage_path: compactText(attachment.storagePath, 2000) || null,
          metadata:
            attachment.metadata &&
            typeof attachment.metadata === "object" &&
            !Array.isArray(attachment.metadata)
              ? attachment.metadata
              : {},
        };
      })
      .filter(Boolean);

    if (attachments.length > 0) {
      const { error: attachmentError } = await supabase
        .from("message_attachments")
        .insert(attachments);
      if (attachmentError) throw attachmentError;
    }

    await supabase.from("audit_events").insert({
      organization_id: organizationId,
      actor_type: "api",
      action: "message.ingested",
      target_type: "message",
      target_id: inserted.id,
      target_label: subject || senderEmail,
      severity: "success",
      metadata: {
        source_connector_id: sourceConnectorId || null,
        external_id: externalId || null,
        attachment_count: attachments.length,
      },
    });

    return jsonResponse(202, {
      ok: true,
      duplicate: false,
      message: inserted,
    });
  } catch (error) {
    console.error("ingest_message_error", error);
    return jsonResponse(500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected ingest error",
    });
  }
});
