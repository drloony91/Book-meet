import test from "node:test";
import assert from "node:assert/strict";
import { JsonShapeError, parsePublicCatalogData, requireJsonRecord } from "../app/services/response-validation.mjs";

test("JSON boundary accepts only object records", () => {
  const record = { section: "catalog" };
  assert.deepEqual(requireJsonRecord(record), record);
  assert.throws(() => requireJsonRecord(null), JsonShapeError);
  assert.throws(() => requireJsonRecord([]), JsonShapeError);
  assert.throws(() => requireJsonRecord("catalog"), JsonShapeError);
});

test("public catalog boundary requires all five collection arrays", () => {
  const valid = { books: [], materials: [], events: [], occasions: [], organizations: [] };
  assert.deepEqual(parsePublicCatalogData(valid), valid);
  for (const key of Object.keys(valid)) {
    const invalid = { ...valid, [key]: {} };
    assert.throws(() => parsePublicCatalogData(invalid), JsonShapeError, key);
  }
  assert.throws(() => parsePublicCatalogData({ books: [], materials: [], events: [], occasions: [] }), JsonShapeError);
  assert.throws(() => parsePublicCatalogData([]), JsonShapeError);
});
