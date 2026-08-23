import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("mobile entities and long workflows own full-page routed surfaces", async () => {
  const [routes, controller, content, actions, css, packageJson] = await Promise.all([
    readFile(path.join(root, "app", "navigation", "routes.ts"), "utf8"),
    readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8"),
    readFile(path.join(root, "app", "components", "content", "ContentComponents.tsx"), "utf8"),
    readFile(path.join(root, "app", "components", "modals", "ModalIconActions.tsx"), "utf8"),
    readFile(path.join(root, "app", "globals.css"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
  ]);

  assert.match(routes, /MobileWorkflowKind/);
  assert.match(routes, /\^\\\/\(create\|edit\)\\\/\(review\|publication\|event\|occasion\|book\|news\)/);
  assert.match(routes, /MobileWorkflowRouteState/);
  assert.match(routes, /"publisher-news"/);
  assert.match(routes, /pattern: \/\^\\\/publishing\\\/\(\\d\+\)\$\/, kind: "publisher-news"/);
  assert.match(routes, /title: string, enabled = true/);
  assert.match(controller, /openMobileWorkflow\(\{ mode: "create", kind: "event" \}\)/);
  assert.match(controller, /openMobileWorkflow\(\{ mode: "edit", kind: "occasion", id: item\.id \}\)/);
  assert.match(controller, /if \(!routeData\.activeUserId\) return;/);
  assert.match(controller, /workflow\.kind === "book" && \["Издатель", "Сообщество"\]\.includes\(viewer\.profile\.type\)/);
  assert.match(controller, /item\.creatorId === viewer\.id \|\| viewer\.isAdmin/);
  assert.match(content, /entity-page-backdrop/);
  assert.match(content, /useRoutedPopup\(`\/publishing\/\$\{item\.id\}`.*mobileRoute\)/);
  assert.match(controller, /selectedPublisherNews/);
  assert.match(controller, /if \(window\.matchMedia\("\(min-width: 801px\)"\)\.matches\)/);
  assert.match(controller, /route\.overlay\.kind === "publisher-news"/);
  assert.match(controller, /!routeData\.blockedByUserIds\.includes\(user\.id\)/);
  assert.match(controller, /owner\?\.publisherNews\?\.find/);
  assert.match(content, /workflow-page-backdrop/);
  assert.match(actions, /mobile \? "<" : "×"/);
  assert.match(actions, /common\.back/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*\.entity-page-backdrop/);
  assert.match(css, /height: 100dvh/);
  assert.match(packageJson, /tests\/mobile-content-routes-contract\.test\.mjs/);
});
