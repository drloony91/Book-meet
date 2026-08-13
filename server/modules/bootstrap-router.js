import { Router } from "express";
import { loadBootstrap } from "../data.js";

const sectionKeys = {
  session: ["activeUserId", "profileCompleted", "linkedProfile"],
  catalog: ["activeUserId", "adultAccess", "users", "books", "events", "occasions"],
  social: ["activeUserId", "blocks", "blockedByUserIds", "friendRequests", "friendships", "communityMemberships", "follows", "notifications", "messages", "likes"],
  moderation: ["activeUserId", "reports"],
};

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function pick(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, object[key]]));
}

export function createBootstrapRouter({ authenticatedUser, loadData = loadBootstrap }) {
  const router = Router();

  async function requireActiveUser(request, response) {
    const user = await authenticatedUser(request);
    if (!user) {
      response.status(401).json({ error: "Требуется вход" });
      return null;
    }
    if (user.suspension) {
      response.status(423).json({ suspended: true, ...user.suspension });
      return null;
    }
    if (user.deletedProfile || user.purged) {
      const daysRemaining = user.deletionExpiresAt ? Math.max(0, Math.ceil((new Date(user.deletionExpiresAt).getTime() - Date.now()) / 86_400_000)) : 0;
      response.status(410).json({ deletedProfile: true, purged: user.purged, daysRemaining });
      return null;
    }
    return user;
  }

  router.get("/bootstrap", asyncRoute(async (request, response) => {
    const user = await requireActiveUser(request, response);
    if (!user) return;
    response.json(await loadData(user.id));
  }));

  router.get("/bootstrap/:section", asyncRoute(async (request, response) => {
    const keys = sectionKeys[request.params.section];
    if (!keys) return response.status(404).json({ error: "Неизвестный набор данных" });
    const user = await requireActiveUser(request, response);
    if (!user) return;
    const sections = request.params.section === "session" ? [] : [request.params.section];
    const data = await loadData(user.id, { sections });
    response.json(pick(data, keys));
  }));

  return router;
}
