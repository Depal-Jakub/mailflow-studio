import { describe, expect, it } from "vitest";
import {
  emptySourceDraft,
  sourcePayload,
  validateSourceDraft,
} from "./connectors";
import {
  deliveryAccountPayload,
  emptyDeliveryAccountDraft,
  validateDeliveryAccount,
} from "./deliveryAccounts";
import { extractVariables, interpolateTemplate } from "./emailTemplates";
import { createBuiltInRoles, hasPermission } from "./permissions";

describe("source configuration", () => {
  it("maps a signed webhook without exposing the secret in public config", () => {
    const draft = emptySourceDraft("webhook");
    draft.name = "CRM";
    const validation = validateSourceDraft(draft);
    const payload = sourcePayload(draft);

    expect(validation.valid).toBe(true);
    expect(payload.public_config).toHaveProperty(
      "signature_header",
      "x-mailflow-signature",
    );
    expect(payload.credentials).toHaveProperty(
      "webhookSecret",
      draft.webhookSecret,
    );
    expect(payload.public_config).not.toHaveProperty("webhookSecret");
  });

  it("requires a selector only in selector mode", () => {
    const draft = emptySourceDraft("scraper");
    draft.name = "Aktualności";
    draft.url = "https://example.com/news";
    draft.extractionMode = "selector";
    draft.cssSelector = "";

    expect(validateSourceDraft(draft).errors.cssSelector).toBeTruthy();
    draft.cssSelector = "main article";
    expect(validateSourceDraft(draft).valid).toBe(true);
  });
});

describe("delivery configuration", () => {
  it("keeps SMTP credentials outside public configuration", () => {
    const draft = emptyDeliveryAccountDraft("smtp");
    Object.assign(draft, {
      name: "Biuro",
      fromEmail: "biuro@example.com",
      host: "smtp.example.com",
      username: "biuro@example.com",
      password: "app-password",
    });
    const payload = deliveryAccountPayload(draft);

    expect(validateDeliveryAccount(draft).valid).toBe(true);
    expect(payload.public_config).not.toHaveProperty("password");
    expect(payload.credentials).toHaveProperty("password", "app-password");
  });
});

describe("templates and permissions", () => {
  it("extracts unique template variables and interpolates nested keys", () => {
    expect(
      extractVariables(
        "Cześć {{ recipient.name }}",
        "{{action.url}} {{recipient.name}}",
      ),
    ).toEqual(["action.url", "recipient.name"]);
    expect(
      interpolateTemplate("Cześć {{recipient.name}}", {
        "recipient.name": "Anna",
      }),
    ).toBe("Cześć Anna");
  });

  it("assigns organization-specific permissions to built-in roles", () => {
    const roles = createBuiltInRoles("org-test");
    const owner = roles.find((role) => role.key === "owner");
    const viewer = roles.find((role) => role.key === "viewer");

    expect(owner?.organizationId).toBe("org-test");
    expect(hasPermission(owner, "organization.billing")).toBe(true);
    expect(hasPermission(viewer, "sources.manage")).toBe(false);
  });
});
