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
  assert.match(chat, /message-like-button/);
  assert.match(chat, /aria-pressed=\{Boolean\(message\.likedByViewer\)\}/);
  assert.match(chat, /<div className="message-inline-actions">[\s\S]+message-like-button/, "message controls must stay outside the message bubble");
  assert.match(chat, /message\.mine && !message\.attachment && !message\.sticker && <button className="message-edit-button"/);
  assert.match(chat, /message\.mine && <button className="message-delete-button"/);
  assert.match(chat, /className="message-edit-form"/);
  assert.match(css, /\.app-shell\.mobile-chat-route \.topbar/);
  assert.match(css, /\.app-shell\.mobile-chat-dialog-active \.mobile-bottom-navigation/);
  assert.match(css, /\.desktop-chat-page \{ display: contents; \}/);
  assert.match(css, /\.message-like-button, \.message-edit-button, \.message-delete-button \{[^}]*display: inline-flex/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*\.message-like-button, \.message-edit-button, \.message-delete-button \{ flex-basis: 32px/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*\.message-bubble\.is-editing \{ width: 86%/);
  assert.match(css, /@media \(min-width: 801px\)[\s\S]*\.workspace-chat-page > \.workspace-main/);
  assert.match(packageJson, /tests\/mobile-chat-contract\.test\.mjs/);
});
