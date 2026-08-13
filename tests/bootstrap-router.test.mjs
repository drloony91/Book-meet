import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createBootstrapRouter } from "../server/modules/bootstrap-router.js";

function requestJson(server, path) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port: address.port, path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.on("error", reject);
  });
}

async function withServer(router, run) {
  const app = express();
  app.use("/api", router);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run(server);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("bootstrap API не отдает данные без сессии", async () => {
  const router = createBootstrapRouter({ authenticatedUser: async () => null, loadData: async () => assert.fail("loader must not run") });
  await withServer(router, async (server) => {
    const response = await requestJson(server, "/api/bootstrap/session");
    assert.equal(response.status, 401);
    assert.equal(response.body.error, "Требуется вход");
  });
});

test("bootstrap API запрашивает только выбранную секцию и не смешивает ответы", async () => {
  const calls = [];
  const loadData = async (userId, options) => {
    calls.push({ userId, options });
    return { activeUserId: userId, users: [{ id: 7 }], books: [{ id: 88, title: "Книга без владельца" }], events: [], occasions: [], messages: { secret: [] }, reports: [{ id: 9 }] };
  };
  const router = createBootstrapRouter({ authenticatedUser: async () => ({ id: 7 }), loadData });
  await withServer(router, async (server) => {
    const response = await requestJson(server, "/api/bootstrap/catalog");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { activeUserId: 7, users: [{ id: 7 }], books: [{ id: 88, title: "Книга без владельца" }], events: [], occasions: [] });
    assert.deepEqual(calls, [{ userId: 7, options: { sections: ["catalog"] } }]);
  });
});
