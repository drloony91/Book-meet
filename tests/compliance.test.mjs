import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGAL_DOCUMENT_TYPES,
  REQUIRED_LEGAL_DOCUMENT_TYPES,
  assertAgeCompatible,
  assertLegalDocumentDeletable,
  legalAccessState,
  legalConsentRequired,
  legalDocumentWriteMode,
  metadataHash,
  profileAccessState,
  validateLegalAcceptance,
} from "../server/modules/compliance.js";

test("community moderation rules are managed without becoming an implicit registration consent", () => {
  assert.deepEqual(LEGAL_DOCUMENT_TYPES, ["user_agreement", "privacy_policy", "personal_data_consent", "community_moderation_rules"]);
  assert.deepEqual(REQUIRED_LEGAL_DOCUMENT_TYPES, ["user_agreement", "privacy_policy", "personal_data_consent"]);
});

test("audit metadata is deterministic and never stores the raw network value", () => {
  const previous = process.env.AUDIT_HASH_SECRET;
  process.env.AUDIT_HASH_SECRET = "test-only-audit-secret";
  try {
    const first = metadataHash("203.0.113.7");
    assert.equal(first, metadataHash("203.0.113.7"));
    assert.notEqual(first, "203.0.113.7");
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(metadataHash(""), null);
  } finally {
    if (previous === undefined) delete process.env.AUDIT_HASH_SECRET;
    else process.env.AUDIT_HASH_SECRET = previous;
  }
});

test("profile access uses actual required fields and exempts organization birth dates", async () => {
  const personal = { query: async () => [[{ role: "user", profile_type: "Читатель", display_name: "", city: "", city_id: null, birth_date: null }]] };
  assert.deepEqual(await profileAccessState(personal, 1), { complete: false, missing: ["name", "username", "city", "birthDate", "gender"] });

  const publisher = { query: async () => [[{ role: "user", profile_type: "Издатель", display_name: "Издательство", city: "Астана", city_id: 1, birth_date: null }]] };
  assert.deepEqual(await profileAccessState(publisher, 2), { complete: true, missing: [] });
});

test("adult and minor direct interaction is rejected on the server", async () => {
  const connection = { query: async () => [[
    { id: 1, role: "user", profile_type: "Читатель", birth_date: "1990-01-01" },
    { id: 2, role: "user", profile_type: "Читатель", birth_date: "2012-01-01" },
  ]] };
  await assert.rejects(() => assertAgeCompatible(connection, 1, 2), (error) => error?.code === "CROSS_AGE_INTERACTION_FORBIDDEN" && error?.statusCode === 403);
});

test("registration accepts only the complete current legal document set", async () => {
  const documents = ["user_agreement", "privacy_policy", "personal_data_consent"].map((type, index) => ({
    id: index + 1,
    document_type: type,
    version: "2026.1",
    language_code: "ru",
    title: type,
    content: "text",
    requires_reacceptance: 1,
    published_at: new Date("2026-08-16T00:00:00Z"),
  }));
  const connection = { query: async (sql) => sql.includes("FROM legal_documents") ? [documents] : [[]] };
  const completePayload = { agreementAccepted: true, personalDataAccepted: true, documentIds: [1, 2, 3] };

  assert.equal(legalConsentRequired({}), true);
  assert.equal(legalConsentRequired({ LEGAL_CONSENT_REQUIRED: "1" }), true);
  const acceptedByDefault = await validateLegalAcceptance(connection, completePayload, "ru", {});
  const acceptedWhenExplicit = await validateLegalAcceptance(connection, completePayload, "ru", { LEGAL_CONSENT_REQUIRED: "1" });
  assert.equal(acceptedByDefault.length, 3);
  assert.equal(acceptedWhenExplicit.length, 3);

  await assert.rejects(() => validateLegalAcceptance(connection, { ...completePayload, documentIds: [1, 2] }, "ru", {}), (error) => error?.code === "LEGAL_ACCEPTANCE_REQUIRED");
  await assert.rejects(() => validateLegalAcceptance(connection, { ...completePayload, personalDataAccepted: false }, "ru", { LEGAL_CONSENT_REQUIRED: "1" }), (error) => error?.code === "LEGAL_ACCEPTANCE_REQUIRED");
});

test("legal consent can be temporarily disabled without recording a false acceptance", async () => {
  assert.equal(legalConsentRequired({}), true);
  assert.equal(legalConsentRequired({ LEGAL_CONSENT_REQUIRED: "0" }), false);
  assert.equal(legalConsentRequired({ LEGAL_CONSENT_REQUIRED: "off" }), false);

  let queries = 0;
  const validationConnection = { query: async () => { queries += 1; return [[]]; } };
  const accepted = await validateLegalAcceptance(validationConnection, null, "ru", { LEGAL_CONSENT_REQUIRED: "0" });
  assert.deepEqual(accepted, []);
  assert.equal(queries, 0);

  const documents = [
    { id: 1, document_type: "user_agreement", version: "1", language_code: "ru", title: "Agreement", content: "Text", requires_reacceptance: 1, published_at: new Date("2026-08-16T00:00:00Z") },
    { id: 2, document_type: "privacy_policy", version: "1", language_code: "ru", title: "Privacy", content: "Text", requires_reacceptance: 1, published_at: new Date("2026-08-16T00:00:00Z") },
    { id: 3, document_type: "personal_data_consent", version: "1", language_code: "ru", title: "Consent", content: "Text", requires_reacceptance: 1, published_at: new Date("2026-08-16T00:00:00Z") },
    { id: 4, document_type: "community_moderation_rules", version: "1", language_code: "ru", title: "Rules", content: "Text", requires_reacceptance: 0, published_at: new Date("2026-08-16T00:00:00Z") },
  ];
  const accessConnection = { query: async (sql) => sql.includes("FROM legal_documents") ? [documents] : [[{ document_id: 1 }]] };
  const state = await legalAccessState(accessConnection, 7, "ru", { LEGAL_CONSENT_REQUIRED: "false" });
  assert.equal(state.configured, true);
  assert.deepEqual(state.pending, []);
  assert.equal(state.documents.length, 4);
});

test("accepted legal text is revised instead of overwritten or deleted", () => {
  assert.equal(legalDocumentWriteMode(0, "1.0", "1.0"), "update");
  assert.equal(legalDocumentWriteMode(3, "1.0", "1.1"), "revision");
  assert.throws(() => legalDocumentWriteMode(3, "1.0", "1.0"), (error) => error?.code === "LEGAL_DOCUMENT_NEW_VERSION_REQUIRED" && error?.statusCode === 409);
  assert.doesNotThrow(() => assertLegalDocumentDeletable(0));
  assert.throws(() => assertLegalDocumentDeletable(1), (error) => error?.code === "LEGAL_DOCUMENT_IN_USE" && error?.statusCode === 409);
});
