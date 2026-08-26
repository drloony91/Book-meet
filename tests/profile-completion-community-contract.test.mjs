import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("organization books, profile completion and avatar contracts are enforced in both adapters", async () => {
  const [m035, m036, m037, api, demo, data, compliance, profiles, content, directory, header, css, index, controller, apiFetch, messages] = await Promise.all([
    readFile(path.join(root, "mysql/migrations/035_community_book_month.sql"), "utf8"),
    readFile(path.join(root, "mysql/migrations/036_privacy_friends_defaults.sql"), "utf8"),
    readFile(path.join(root, "mysql/migrations/037_publisher_book_dates.sql"), "utf8"),
    readFile(path.join(root, "server/api.js"), "utf8"), readFile(path.join(root, "server/demo-api.js"), "utf8"),
    readFile(path.join(root, "server/data.js"), "utf8"), readFile(path.join(root, "server/modules/compliance.js"), "utf8"),
    readFile(path.join(root, "app/screens/ProfileScreens.tsx"), "utf8"), readFile(path.join(root, "app/components/content/ContentComponents.tsx"), "utf8"), readFile(path.join(root, "app/screens/UsersDirectoryScreen.tsx"), "utf8"),
    readFile(path.join(root, "app/components/layout/AppLayout.tsx"), "utf8"), readFile(path.join(root, "app/globals.css"), "utf8"), readFile(path.join(root, "index.html"), "utf8"), readFile(path.join(root, "app/hooks/useBookMeetController.tsx"), "utf8"), readFile(path.join(root, "app/services/api.ts"), "utf8"), readFile(path.join(root, "app/i18n/messages.ts"), "utf8"),
  ]);
  assert.match(m035, /featured_month/); assert.match(m035, /featured_year/); assert.match(m035, /CHECK/);
  assert.match(m036, /show_birth_date_to_friends BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(m036, /birth_date_visibility.*DEFAULT 'friends'/); assert.match(m036, /followers_visibility = 'friends'/);
  assert.match(m037, /publication_month/); assert.match(m037, /publication_year/); assert.match(m037, /CHECK/);
  for (const source of [api, demo]) {
    assert.match(source, /community-books/); assert.match(source, /users\/me\/avatar/); assert.match(source, /\["Читатель", "Писатель", "Блогер"\]/);
  }
  assert.match(api, /assertCommunityOwner/); assert.match(api, /readableMaterialInfo[\s\S]*PROFILE_COMPLETION_REQUIRED/);
  assert.match(data, /memberIds:/); assert.match(data, /const communityBooks/); assert.match(data, /previewOnlyUsers/);
  assert.match(data, /profileGate\.complete \? catalogBooks/); assert.match(data, /description: profileGate\.complete/); assert.match(data, /audienceText: profileGate\.complete/);
  assert.match(demo, /const visibleBooks = [\s\S]*profileGate\.complete/);
  assert.match(demo, /const visibleEvents = [\s\S]*description: ""/);
  assert.match(demo, /const visibleOccasions = [\s\S]*audienceText: ""/);
  assert.match(compliance, /username_is_temporary/); assert.match(compliance, /missing.push\("gender"\)/);
  assert.match(profiles, /CommunityBooksTab/); assert.match(profiles, /organizationType="publisher"/);
  assert.match(profiles, /const publisher = \["Издатель", "Сообщество"\]\.includes\(profile\.type\)/);
  assert.match(profiles, /city: !publisher && !profile\.cityId/);
  assert.match(profiles, /keepsOrganizationUsername/);
  assert.match(api, /isOrganization && !String\(profile\.city \?\? ""\)\.trim\(\) && !profile\.cityId/);
  assert.match(profiles, /profile\.type !== "Сообщество" && \[/);
  assert.match(content, /assignedGroups\.map/);
  assert.match(content, /group\.length >= 3 \? "is-wide"/);
  assert.match(content, /monthLabel\(group\[0\]\)/);
  assert.match(content, /mode\?: "library" \| "community" \| "publisher"/);
  assert.match(content, /BookAutofillField/);
  assert.match(content, /organizationMode && <fieldset className="reading-date-field organization-book-date-field"/);
  assert.match(content, /featuredMonth/); assert.match(content, /publicationMonth/);
  assert.match(css, /\.community-featured-groups \{[^}]*grid-template-columns: repeat\(2/);
  assert.match(css, /\.community-featured-group\.is-wide \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /\.community-book-grid \{[^}]*repeat\(4/);
  assert.match(directory, /pageSize = 12/); assert.match(directory, /user\.profileCompleted \?\?/);
  assert.match(header, /mobile-brand-logo/); assert.match(header, /desktop-brand-mark/); assert.match(index, /book-meet-favicon-v3\.png/);
  assert.match(api, /followers_visibility = 'friends'/); assert.match(demo, /birthDateVisibility: "friends"/);
  assert.match(controller, /bookmeet:profile-completion-required/); assert.match(controller, /material-clickable-card/); assert.match(controller, /completionProfileEditing/);
  assert.match(controller, /organizationKeepsUsername/);
  assert.match(controller, /routeData\.accessGate && !routeData\.accessGate\.profileComplete/);
  assert.match(controller, /\["Читатель", "Писатель", "Блогер"\]\.includes\(currentUser\.profile\.type\)/);
  assert.match(apiFetch, /response\.clone\(\)\.json/); assert.match(messages, /access\.profileCompletionText/);
});
