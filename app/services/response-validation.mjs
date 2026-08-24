/** @typedef {import("../types/domain").PublicCatalogData} PublicCatalogData */

export class JsonShapeError extends Error {
  constructor(message) {
    super(message);
    this.name = "JsonShapeError";
  }
}

/** @returns {Record<string, unknown>} */
export function requireJsonRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new JsonShapeError("Expected a JSON object");
  }
  return value;
}

/** @returns {PublicCatalogData} */
export function parsePublicCatalogData(value) {
  const record = requireJsonRecord(value);
  const collections = ["books", "materials", "events", "occasions", "organizations"];
  for (const key of collections) {
    if (!Array.isArray(record[key])) throw new JsonShapeError(`Expected ${key} to be an array`);
  }
  return {
    books: /** @type {PublicCatalogData["books"]} */ (record.books),
    materials: /** @type {PublicCatalogData["materials"]} */ (record.materials),
    events: /** @type {PublicCatalogData["events"]} */ (record.events),
    occasions: /** @type {PublicCatalogData["occasions"]} */ (record.occasions),
    organizations: /** @type {PublicCatalogData["organizations"]} */ (record.organizations),
  };
}
