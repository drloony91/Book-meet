import { Router } from "express";
import { getPool } from "../db.js";
import { normalizeIdentity } from "../security.js";
import { CYRILLIC_CITY_PATTERN } from "./material-input.js";

export function createLocationRouter({ asyncRoute }) {
  const router = Router();

  router.get("/cities", asyncRoute(async (request, response) => {
    const query = normalizeIdentity(request.query.q ?? "").slice(0, 120);
    if (query.length < 1 || !CYRILLIC_CITY_PATTERN.test(query)) return response.json({ cities: [] });
    const [rows] = await getPool().query(
      `SELECT DISTINCT id, name, country_code, country_name, population, name_key
         FROM (
           SELECT c.id, c.name, c.country_code, c.country_name, c.population, c.name_key FROM cities c
           UNION ALL
           SELECT c.id, ca.name, c.country_code, c.country_name, c.population, ca.name_key
             FROM city_aliases ca JOIN cities c ON c.id = ca.city_id
         ) city_names
        WHERE name_key LIKE ?
        ORDER BY CASE WHEN name_key = ? THEN 0 WHEN name_key LIKE ? THEN 1 ELSE 2 END, population DESC, name
        LIMIT 80`,
      [`%${query}%`, query, `${query}%`],
    );
    response.json({
      cities: rows
        .filter((row) => CYRILLIC_CITY_PATTERN.test(row.name))
        .slice(0, 20)
        .map((row) => ({ id: Number(row.id), name: row.name, countryCode: row.country_code, country: row.country_name })),
    });
  }));

  return router;
}
