# Routes and API

## Frontend route groups

Routing is a small History API implementation in `app/navigation/routes.ts`; React Router is not used. `appRouteFromPathname()` maps paths to a main view, overlay or mobile workflow. Desktop main navigation and mobile workflows intentionally differ.

| Group | Paths / route state | Screen/owner | Access |
| --- | --- | --- | --- |
| Authentication shell | Any application route without an active session | `AuthScreens.tsx`, `useBookMeetController.tsx` | unauthenticated visitors see only login/registration; the requested same-origin path is restored after login |
| Main authenticated views | `/liked`, `/saved`, `/notifications`, `/chat`, plus all main paths | `ContentScreens.tsx`, `ChatScreen.tsx`, `app/components/notifications/Notifications.tsx` | session; content remains viewer-filtered |
| Profile tabs | `/profile`, `/profile/books`, `/profile/blog`, `/profile/news`, `/profile/library`, `/profile/wishlist`, `/profile/communities`, `/profile/reviews`, `/profile/events`, `/profile/occasions`, `/profile/friends`, `/profile/admin` | `ProfileScreens.tsx` | own profile, public profile or friendship/privacy; admin tab admin |
| Dynamic overlays | `/users/:id`, `/books/:id`, `/shelves/:id`, `/events/:id`, `/reviews/:id`, `/blog/:id`, `/meet/:id`, `/publishing/:id`, `/chat/:id`, `/notifications/:id`, `/reports/:kind/:id` | routed popup logic and controller open/close helpers | route may be public, but server decides readable material/chat/report |
| Mobile-only workflows | `/search`, `/create|edit/{review,publication,event,occasion,book,news,reading-goal,shelf}[/:id]`, `/edit/book-status/:id`, `/profile/{followers,following,friends,incoming,outgoing}` | `MobileGlobalSearchPage.tsx`, mobile forms and `routes.ts` | mobile media query; mutation requires session/ownership |

`openOverlayRoute` and `closeOverlayRoute` own History API stack/back behavior. Direct SPA paths are served by `server/index.js` fallback in production.

## Backend endpoint groups

All paths below are mounted under `/api` (for example, `/api/auth/login`, `/api/bootstrap/session`, `/api/books`, `/api/events`, `/api/occasions`, `/api/social/messages`, `/api/admin/reports/:id` and `/api/realtime`). `apiFetch` sends same-origin credentials and locale headers. `server/api.js` handlers apply `authenticatedUser`, `isAdmin`, ownership, block, age and legal checks as appropriate; a UI-hidden action is not an authorization boundary.

| Group | Representative endpoints | Auth requirement | Handler/module/data |
| --- | --- | --- | --- |
| Health/public/auth | `GET /health`, `/auth/providers`, `/auth/legal-documents`, `/public/catalog`; `/auth/login`, `/auth/register`, Google callback/credential, email verify/reset, logout, deleted restore/new | the application UI remains authentication-only without a session; auth bootstrap is private, while narrowly projected support endpoints remain data-minimized | `server/api.js`, `server/security.js`, `server/modules/compliance.js`, `server/modules/public-catalog.js` |
| Bootstrap/location | `GET /bootstrap`, `/bootstrap/:section`, `/cities` | session bootstrap; public city/catalog branches as implemented | `server/modules/bootstrap-router.js`, `location-router.js`, `server/data.js` |
| Search | `GET /search/materials` | authenticated viewer for private-aware search | `server/modules/material-search.js`, `server/data.js` |
| Account/profile | `PUT /users/me/state`, `PATCH /users/me/home-view`, `/users/me/profile-complete`, `DELETE /users/me/profile`, `DELETE /users/me/avatar`; `GET/PATCH/DELETE /users/me/telegram*`; linked profile create/attach/google/switch/delete | current user; destructive delete/merge has explicit session checks | `server/api.js`, `server/modules/account-tokens.js`, `compliance.js` |
| TOTP | `GET /auth/totp/status`, `POST /auth/totp/setup/start|confirm`, recovery regenerate, disable | current user; setup/disable verifies password/TOTP state | `server/security.js`, `server/api.js` |
| Books/library | `GET /books/catalog?q=` (trimmed, normalized catalogue; empty `q` returns the full permitted catalogue, non-empty `q` is bounded to 100; canonical books survive a creator account soft-delete), `/books`; `POST /books`, `PATCH`/`DELETE /books/:id`; `POST /books/preview`; admin import preview/resolve | catalog viewer; writes owner/session; status writes are transactionally validated for five reading states and return the owner book DTO plus completion history. Other viewers receive only status, computed percentage and completion indicator. `DELETE /books/:id` removes only the caller's relation and unfinished cycles; import admin | `server/api.js`, `server/data.js`, `material-input.js`, image storage |
| Reading goals/statistics | `GET/POST /reading-goals`, `PATCH`/`DELETE /reading-goals/:id`, `GET /reading-statistics?year=&month=` | current user only; goals are deliberately excluded from bootstrap and all other-user projections. The statistics endpoint calculates pace and annual allocations server-side using the request timezone. | `server/api.js`, `reading-goals.js`, `reading_cycles` |
| Progress notes | `GET/POST /books/:id/notes`, `PATCH`/`DELETE /book-notes/:id` | authenticated viewer for spoiler-filtered reads; owner for writes. Creation requires a currently reading personal library relation and uses the locked server progress snapshot. | `server/api.js`, `book-progress-notes.js`, `book_progress_notes` |
| Book shelves | `GET /users/:id/shelves`, `GET /shelves/:id`, `POST /shelves`, `PATCH`/`DELETE /shelves/:id`, `POST /shelves/:id/add-to-library` | authenticated viewer with block/hide/age filtering; reader owner for CRUD. Batch add inserts only missing readable books as `want`. | `server/api.js`, `book-shelves.js`, `book_shelves`, `book_shelf_items` |
| Community books | `POST /community-books`, `PATCH`/`DELETE /community-books/:id` | only the owning community may associate an existing canonical book; no canonical book mutation or reader status fields | `server/api.js`, `user_books.featured_*` |
| Materials | `POST/PATCH /reviews`, `POST/PATCH /excerpts`, `DELETE /materials/:kind/:id`; admin patch/delete `/admin/materials/:kind/:id` | owner routes create or edit only the caller's material; admin endpoints are separate moderation paths | `server/api.js`, `content-security.js`, `compliance.js` |
| Wishlist | `/wishlist/preview`, `POST /wishlist`, `DELETE /wishlist/:id`, price, reserve/unreserve | session; owner and friendship/privacy checks for gift reservation | `server/api.js`, external book source helpers |
| Feed interactions | `GET/POST/DELETE /reactions`, `/saves`, `/comments`; `GET /material-stats` | session for writes; readable material/age/block checks for reads | `server/api.js` and request-local material permission cache |
| Events/occasions | `POST/PATCH/DELETE /events`, attendee list, reminder; admin event moderation; matching `/occasions` and admin moderation | session; creator ownership; admin moderation | `server/api.js`, `material-input.js`, `server/data.js` |
| Social | friend request create/delete, accept/reject/remove; follow/unfollow; block/unblock | session; pair policy, age, profile type and block checks | `server/modules/social-permissions.js`, `compliance.js`, `server/api.js` |
| Chat/notifications/realtime | `POST /social/messages`, `PATCH /social/messages/:targetId/read`, `DELETE /social/messages/:targetId/history`; `PATCH /notifications/read-all`/`:id/read`; `GET /realtime` | session; friends/community/**publisher**/admin support via `canMessagePair`, plus block/age checks. Message attachments support `book`, `user`, `event`, `review`, `excerpt`, `occasion`, approved `publisher_news` and readable `shelf`; both participants must be able to read the exact material, including block/age visibility. Clear records a per-viewer cursor through the current pair maximum; it does not delete messages, friendship or the peer's history. Personal messages update chat unread/read state and SSE only, not the general notification center. | `server/api.js`, `server/modules/social-permissions.js`, `messages`, `chat_history_clears`, `notifications`, SSE broadcaster |
| Reports/moderation | `POST /reports`, mine, appeal; admin report status/processed/delete-material; admin user suspension/restore/permanent | authenticated reporter; admin for review/destructive actions | `server/api.js`, `compliance.js`, `moderation_audit_log` |
| Legal/admin/compliance | `/legal/acceptances`; admin legal-document CRUD, audit/security logs, sessions, age audit, incidents, statistics | legal acceptance user; admin for document/audit/statistics writes/reads | `server/modules/compliance.js`, `server/api.js`, `AdminCompliancePanel.tsx`, `AdminStatisticsPanel.tsx` |

## Compatibility/demo notes

Reading-goal creation validates positive integer counts and calendar periods in `X-BookMeet-Timezone`: months from the current month through December, next year always, current year only in January/February. Annual `NULL` months use a generated unique slot, so duplicate concurrent requests return `409 READING_GOAL_DUPLICATE`. `PATCH /reading-goals/:id` changes the count; period changes return `422 READING_GOAL_PERIOD_IMMUTABLE`. An unknown or another user's goal returns `404`; administrator status does not grant access to other users' private goals. Statistics use completed `reading_cycles`, including rereads and history retained after a library relation is removed.

`server/demo-api.js` implements an in-memory subset for demo smoke and is not the MySQL production contract. `/api/bootstrap` remains for older clients while new client code requests sections. Endpoint details are intentionally grouped here; inspect `server/api.js` at the route group before changing a handler.

For an exact generated production route inventory, see [generated/API_ROUTES.md](./generated/API_ROUTES.md) and [generated/FRONTEND_ROUTES.md](./generated/FRONTEND_ROUTES.md). They are refreshed with `pnpm docs:generate` and checked for drift by `pnpm docs:check`; this document remains the semantic ownership and access guide.

## Progress note contracts

`GET /api/books/:id/notes?scope=mine|all&cursor=` returns `{notes,nextCursor}` in descending ID order with server-side visibility filtering before pagination. `POST /api/books/:id/notes` accepts `{body,expectedProgress?:{unit,current,total,percent}}` for a currently reading personal library book. A stale confirmation returns `409 BOOK_NOTE_PROGRESS_CHANGED`. `PATCH /api/book-notes/:id` accepts only `{body}`; `DELETE /api/book-notes/:id` is owner scoped. `POST /api/reports` accepts target kind `book_note` only when the reporter can read that exact note; admin report deletion uses the existing moderation/audit flow.

The book card notes tab is inline. Saving from the personal thoughts field opens a confirmation and keeps the thoughts unchanged. Closed note bodies are never placed in ordinary bootstrap data. Successful writes use the existing response-after-commit realtime broadcast and do not replace the client user snapshot.

## Book shelf contracts

Shelf list responses are cursor-paginated and contain at most the first four book previews per card; `/api/shelves/:id` returns the ordered detail. Title and descriptions use Unicode code-point limits, items must be unique, and creation/editing accepts at least one book from the owner's current library. `/api/shelves/:id/add-to-library` is idempotent and returns added, already-present and unavailable counts plus the added owner DTOs.

`shelf` participates in reactions, comments, private saves, reports, moderation, material search, notifications and chat attachments. Direct shelf routes use `/shelves/:id`; mobile create/edit routes use `/create/shelf` and `/edit/shelf/:id`. Overlay and workflow history retain the full background path including the library `mode=shelves` query.
