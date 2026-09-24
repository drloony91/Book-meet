import assert from "node:assert/strict";
import test from "node:test";
import { canSeeReadingPresence, readingPresenceVisibility } from "../server/modules/reading-presence.js";

const base = { viewerId: 2, readerId: 1, visibility: "everyone", running: true, leaseActive: true, bookReadable: true, blocked: false, ageCompatible: true, friends: false, follower: false };

test("reading presence fails closed on stale sessions and viewer safety boundaries", () => {
  for (const denied of [{ running: false }, { leaseActive: false }, { bookReadable: false }, { blocked: true }, { ageCompatible: false }]) {
    assert.equal(canSeeReadingPresence({ ...base, ...denied }), false);
  }
  assert.equal(canSeeReadingPresence({ ...base, viewerId: 1, visibility: "nobody" }), true, "owner may still render their own active avatar");
  assert.equal(canSeeReadingPresence({ ...base, viewerId: 1, leaseActive: false }), false);
});

test("reading presence audience modes never widen an unknown setting", () => {
  assert.equal(readingPresenceVisibility("unexpected"), "nobody");
  assert.equal(canSeeReadingPresence({ ...base, visibility: "unexpected" }), false);
  assert.equal(canSeeReadingPresence({ ...base, visibility: "nobody" }), false);
  assert.equal(canSeeReadingPresence({ ...base, visibility: "friends", friends: true }), true);
  assert.equal(canSeeReadingPresence({ ...base, visibility: "friends", follower: true }), false);
  assert.equal(canSeeReadingPresence({ ...base, visibility: "followers", follower: true }), true);
  assert.equal(canSeeReadingPresence({ ...base, visibility: "followers", friends: true }), false);
  assert.equal(canSeeReadingPresence(base), true);
});
