const sampleVariables: Record<string, string> = {
  "recipient.name": "Anna Nowak",
  "recipient.email": "anna@example.com",
  "message.reference": "#MF-2026-0727",
  "message.summary":
    "Twoja sprawa została zaklasyfikowana i jest gotowa do dalszej obsługi.",
  "action.url": "https://example.com/sprawy/MF-2026-0727",
  "agent.name": "Zespół MailFlow",
  "company.name": "Example Sp. z o.o.",
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export function interpolateTemplate(
  template: string,
  variables: Record<string, string> = sampleVariables,
) {
  return template.replace(
    /\{\{\s*([\w.-]+)\s*\}\}/g,
    (_match, key: string) => variables[key] ?? `{{${key}}}`,
  );
}

export function sanitizeEmailHtml(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  document
    .querySelectorAll(
      "script,iframe,object,embed,form,input,button,textarea,select,meta,base",
    )
    .forEach((node) => node.remove());
  document.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        ((name === "href" || name === "src") &&
          (value.startsWith("javascript:") || value.startsWith("data:text/html")))
      ) {
        element.removeAttribute(attribute.name);
      }
    });
  });
  return document.body.innerHTML;
}

export function htmlToText(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  return (document.body.textContent ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractVariables(...templates: string[]) {
  const variables = new Set<string>();
  templates.forEach((template) => {
    for (const match of template.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) {
      variables.add(match[1]);
    }
  });
  return [...variables].sort();
}

export function emailPreviewDocument({
  html,
  subject,
  senderName,
  senderEmail,
}: {
  html: string;
  subject: string;
  senderName: string;
  senderEmail: string;
}) {
  const safeHtml = interpolateTemplate(sanitizeEmailHtml(html));
  const safeSubject = escapeHtml(interpolateTemplate(subject));
  const safeSenderName = escapeHtml(senderName);
  const safeSenderEmail = escapeHtml(senderEmail);
  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 28px; background: #eef3f6; color: #061d2b; font: 15px/1.6 Inter, Arial, sans-serif; }
      .mail { max-width: 680px; margin: 0 auto; background: #fff; border: 1px solid #d8e1e7; }
      .meta { padding: 20px 24px; border-bottom: 1px solid #e6edf1; }
      .meta strong, .meta span { display: block; }
      .meta span { color: #688095; font-size: 13px; margin-top: 3px; }
      .subject { padding: 18px 24px; border-bottom: 1px solid #e6edf1; font-size: 18px; font-weight: 700; }
      .content { padding: 28px 24px 34px; }
      h1, h2, h3 { line-height: 1.25; margin: 0 0 16px; }
      p { margin: 0 0 16px; }
      a { color: #08736f; }
      .email-info-box { margin: 18px 0; padding: 14px 16px; background: #effbf9; border-left: 3px solid #0b8b84; }
      .email-info-box span, .email-info-box strong { display: block; }
      .email-info-box span { color: #466579; font-size: 12px; text-transform: uppercase; }
      .email-cta { display: inline-block; padding: 11px 16px; background: #08736f; color: #fff !important; text-decoration: none; font-weight: 700; }
      .footer { padding: 16px 24px; color: #688095; background: #f7f9fb; border-top: 1px solid #e6edf1; font-size: 12px; }
    </style>
  </head>
  <body>
    <article class="mail">
      <div class="meta"><strong>${safeSenderName}</strong><span>${safeSenderEmail}</span></div>
      <div class="subject">${safeSubject}</div>
      <div class="content">${safeHtml}</div>
      <div class="footer">Wiadomość przygotowana w MailFlow Studio</div>
    </article>
  </body>
</html>`;
}
