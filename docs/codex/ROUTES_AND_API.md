# Routes and API

## Frontend route groups

Routing is a small History API implementation in `app/navigation/routes.ts`; React Router is not used. `appRouteFromPathname()` maps paths to a main view, overlay or mobile workflow. Desktop main navigation and mobile workflows intentionally differ.

| Group | Paths / route state | Screen/owner | Access |
| --- | --- | --- | --- |
| Authentication shell | Any application route without an active session | `AuthScreens.tsx`, `useBookMeetController.tsx` | unauthenticated visitors see only login/registration; the requested same-origin path is restored after login |
| Main authenticated views | `/liked`, `/saved`, `/notifications`, `/chat`, plus all main paths | `ContentScreens.tsx`, `ChatScreen.tsx`, `app/components/notifications/Notifications.tsx` | session; content remains viewer-filtered |
| Profile tabs | `/profile`, `/profile/books`, `/profile/blog`, `/profile/news`, `/profile/library`, `/profile/wishlist`, `/profile/communities`, `/profile/reviews`, `/profile/events`, `/profile/occasions`, `/profile/friends`, `/profile/admin` | `ProfileScreens.tsx` | own profile, public profile or friendship/privacy; admin tab admin |
| Dynamic overlays | `/users/:id`, `/books/:id`, `/events/:id`, `/reviews/:id`, `/blog/:id`, `/meet/:id`, `/publishing/:id`, `/chat/:id`, `/notifications/:id`, `/reports/:kind/:id` | routed popup logic and controller open/close helpers | route may be public, but server decides readable material/chat/report |
| Mobile-only workflows | `/search`, `/create|edit/{review,publication,event,occasion,book,news}[/:id]`, `/profile/{followers,following,friends,incoming,outgoing}` | `MobileGlobalSearchPage.tsx`, mobile forms and `routes.ts` | mobile media query; mutation requires session/ownership |

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
| Books/library | `GET /books/catalog`, `/books`; `POST /books`, `PATCH`/`DELETE /books/:id`; `POST /books/preview`; admin import preview/resolve | catalog viewer; writes owner/session; import admin | `server/api.js`, `server/data.js`, `material-input.js`, image storage |
| Community books | `POST /community-books`, `PATCH`/`DELETE /community-books/:id` | only the owning community may associate an existing canonical book; no canonical book mutation or reader status fields | `server/api.js`, `user_books.featured_*` |
| Materials | `POST/PATCH /reviews`, `POST/PATCH /excerpts`, `DELETE /materials/:kind/:id`; admin patch/delete `/admin/materials/:kind/:id` | owner routes create or edit only the caller's material; admin endpoints are separate moderation paths | `server/api.js`, `content-security.js`, `compliance.js` |
| Wishlist | `/wishlist/preview`, `POST /wishlist`, `DELETE /wishlist/:id`, price, reserve/unreserve | session; owner and friendship/privacy checks for gift reservation | `server/api.js`, external book source helpers |
| Feed interactions | `GET/POST/DELETE /reactions`, `/saves`, `/comments`; `GET /material-stats` | session for writes; readable material/age/block checks for reads | `server/api.js` and request-local material permission cache |
| Events/occasions | `POST/PATCH/DELETE /events`, attendee list, reminder; admin event moderation; matching `/occasions` and admin moderation | session; creator ownership; admin moderation | `server/api.js`, `material-input.js`, `server/data.js` |
| Social | friend request create/delete, accept/reject/remove; follow/unfollow; block/unblock | session; pair policy, age, profile type and block checks | `server/modules/social-permissions.js`, `compliance.js`, `server/api.js` |
| Chat/notifications/realtime | `POST /social/messages`, mark read; `PATCH /notifications/read-all`/`:id/read`; `GET /realtime` | session; friends/community/**publisher**/admin support via `canMessagePair`, plus block/age checks | `server/api.js`, `server/modules/social-permissions.js`, `messages`, `notifications`, SSE broadcaster |
| Reports/moderation | `POST /reports`, mine, appeal; admin report status/processed/delete-material; admin user suspension/restore/permanent | authenticated reporter; admin for review/destructive actions | `server/api.js`, `compliance.js`, `moderation_audit_log` |
| Legal/admin/compliance | `/legal/acceptances`; admin legal-document CRUD, audit/security logs, sessions, age audit, incidents, statistics | legal acceptance user; admin for document/audit/statistics writes/reads | `server/modules/compliance.js`, `server/api.js`, `AdminCompliancePanel.tsx`, `AdminStatisticsPanel.tsx` |

## Compatibility/demo notes

`server/demo-api.js` implements an in-memory subset for demo smoke and is not the MySQL production contract. `/api/bootstrap` remains for older clients while new client code requests sections. Endpoint details are intentionally grouped here; inspect `server/api.js` at the route group before changing a handler.

For an exact generated production route inventory, see [generated/API_ROUTES.md](./generated/API_ROUTES.md) and [generated/FRONTEND_ROUTES.md](./generated/FRONTEND_ROUTES.md). They are refreshed with `pnpm docs:generate` and checked for drift by `pnpm docs:check`; this document remains the semantic ownership and access guide.
