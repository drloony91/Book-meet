import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("mobile chat list and dialog are routed screens while desktop chat stays isolated", async () => {
  const [controller, layout, screen, chat, css, routes, packageJson] = await Promise.all([
    readFile(path.join(root, "app", "hooks", "useBookMeetController.tsx"), "utf8"),
    readFile(path.join(root, "app", "components", "layout", "AppLayout.tsx"), "utf8"),
    readFile(path.join(root, "app", "screens", "MobileMessagesPage.tsx"), "utf8"),
    readFile(path.join(root, "app", "components", "chat", "ChatComponents.tsx"), "utf8"),
    readFile(path.join(root, "app", "globals.css"), "utf8"),
    readFile(path.join(root, "app", "navigation", "routes.ts"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
  ]);

  assert.match(routes, /chat: "\/chat"/);
  assert.match(routes, /\^\\\/chat\\\/\(\\d\+\)\$/);
  assert.match(controller, /MobileMessagesPage/);
  assert.match(controller, /currentRoute\.overlay\?\.kind === "chat"/);
  assert.match(controller, /navigateMainView\("chat"\)/);
  assert.doesNotMatch(controller, /setMobileFriendsOpen\(!desktopChat\)/);
  assert.match(layout, /mobileChatPage\?/);
  assert.match(screen, /chat\.incoming/);
  assert.match(screen, /chat\.requests/);
  assert.match(screen, /friend\.username/);
  assert.match(chat, /chat-mobile-back/);
  assert.match(chat, /mobileDialog/);
  assert.match(css, /\.app-shell\.mobile-chat-route \.topbar/);
  assert.match(css, /\.app-shell\.mobile-chat-dialog-active \.mobile-bottom-navigation/);
  assert.match(css, /\.desktop-chat-page \{ display: contents; \}/);
  assert.match(css, /@media \(min-width: 801px\)[\s\S]*\.workspace-chat-page > \.workspace-main/);
  assert.match(packageJson, /tests\/mobile-chat-contract\.test\.mjs/);
});
