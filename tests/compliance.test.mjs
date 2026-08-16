import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAgeCompatible,
  metadataHash,
  profileAccessState,
  validateLegalAcceptance,
} from "../server/modules/compliance.js";

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
  assert.deepEqual(await profileAccessState(personal, 1), { complete: false, missing: ["name", "city", "birthDate"] });

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
  const accepted = await validateLegalAcceptance(connection, { agreementAccepted: true, personalDataAccepted: true, documentIds: [1, 2, 3] }, "ru");
  assert.equal(accepted.length, 3);
  await assert.rejects(() => validateLegalAcceptance(connection, { agreementAccepted: true, personalDataAccepted: false, documentIds: [1, 2, 3] }, "ru"), (error) => error?.code === "LEGAL_ACCEPTANCE_REQUIRED");
});
