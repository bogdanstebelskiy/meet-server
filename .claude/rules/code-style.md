# Code style

Applies to all code written or edited in this repo, in every app and lib.

Never call a function inline as an argument to another function call — extract the result into a named variable first, one call per line, then pass the variable on. This applies repo-wide, not just to Redis/service code.

```ts
// avoid
const raw = await this.redis.hget(this.peersKey(roomId), peerId);

// prefer
const peersKey = this.peersKey(roomId);
const raw = await this.redis.hget(peersKey, peerId);
```

Same idea for chained transformations (`.filter().map()` etc.): split every step in the chain into its own named variable by default, so the code reads top-to-bottom like a book instead of requiring the reader to unwind a chain. A chain with only one step (e.g. a lone `.map()` assigned straight to a variable) is already fine as-is — there's nothing left to split.

```ts
// avoid
return Object.entries(all)
  .filter(([peerId]) => peerId !== excludePeerId)
  .map(([, raw]) => JSON.parse(raw) as Peer);

// prefer
const entries = Object.entries(all);
const otherPeerEntries = entries.filter(([peerId]) => peerId !== excludePeerId);
const otherPeers = otherPeerEntries.map(([, raw]) => JSON.parse(raw) as Peer);
return otherPeers;
```

Avoid ternaries and single-line inline `if`s — use explicit multi-line `if`/`else` blocks with braces instead, so each branch and its effect is its own visible step. When a branch would just return `undefined` (or nothing), don't spell that out — a function that falls off the end already returns `undefined` implicitly, so omit the trailing `return`/`return undefined` entirely.

```ts
// avoid
return raw ? (JSON.parse(raw) as Peer) : undefined;

// prefer
if (raw) {
  return JSON.parse(raw) as Peer;
}
```

A `*.service.ts` file holds only business logic — never a `type`/`interface` declaration, no matter how small or local-feeling. Split any type out into its own file, placed wherever fits the type's role (a domain shape goes in `entities/` next to `Room`/`Peer`, a cross-cutting helper type goes in that module's `types.ts`, a wire-format type goes in `payloads/` — judge it per situation rather than defaulting to one bucket), then import it into the service.

```ts
// avoid — inside rooms.service.ts
export interface RoomProducer {
  producerId: string;
  kind: MediaKind;
}

// prefer — apps/realtime/src/rooms/entities/room-producer.entity.ts
import type { MediaKind } from 'mediasoup/types';

export interface RoomProducer {
  producerId: string;
  kind: MediaKind;
}
```

Same for constants: a `*.service.ts` file doesn't declare its own module-level constants either — move them into their own file (e.g. a `constants.ts` in that module) and import them.

```ts
// avoid — inside rooms.service.ts
const ROOM_TTL_SECONDS = 60 * 60 * 24;

// prefer — apps/realtime/src/rooms/constants.ts
export const ROOM_TTL_SECONDS = 60 * 60 * 24;
```

Use guard clauses instead of nesting the rest of a function inside an `if`. When a condition means "there's nothing more to do," return early rather than wrapping everything that follows in an `if` block — nesting should stay flat, not grow one level per condition checked.

```ts
// avoid
const isRoomEmpty = await this.roomsService.isEmpty(roomId);
if (isRoomEmpty) {
  const closed = await this.roomsService.closeRoom(roomId);
  if (closed) {
    await this.sfuClient.closeRoom(roomId);
  }
}

// prefer
const isRoomEmpty = await this.roomsService.isEmpty(roomId);
if (!isRoomEmpty) {
  return;
}

const closed = await this.roomsService.closeRoom(roomId);
if (!closed) {
  return;
}

await this.sfuClient.closeRoom(roomId);
```

Prefer `async`/`await` with `try`/`catch`/`finally` over chaining `.then()`/`.catch()`/`.finally()` directly on a promise.

```ts
// avoid
const creation = this.createRoom(roomId).finally(() => {
  this.pendingRooms.delete(roomId);
});
this.pendingRooms.set(roomId, creation);
return creation;

// prefer
const creation = this.createRoom(roomId);
this.pendingRooms.set(roomId, creation);

try {
  return await creation;
} finally {
  this.pendingRooms.delete(roomId);
}
```

Exception: a genuine fire-and-forget call (one that's deliberately never awaited, so the caller doesn't block on it) keeps a plain `.catch()` — wrapping it in an async IIFE just to keep `try`/`catch` everywhere adds more bloat than it's worth for a single-line cleanup call.

```ts
// fine as-is — deliberately not awaited by the caller
this.chatService
  .deleteRoomHistory(roomId)
  .catch((error) =>
    this.logger.error(`Failed to delete chat history for room ${roomId}`, error),
  );
```

Comments should read like a human wrote them: short, plain, one or two lines. State the non-obvious *why* and stop — not a multi-paragraph essay walking through every case, alternative considered, and cross-reference.

```ts
// avoid
// Known gap: a realtime instance dying uncleanly (crash/OOM) between a peer
// joining and this running never fires closeRoom at all, so other instances
// keep serving that peer as present until issue #7's liveness/TTL mechanism
// lands - the TTL on every key below is the only safety net for that case
// today. The other race this used to have (issue #24, now fixed) - a peer
// joining in the window between the caller's isEmpty() check and this
// method's own read+delete getting wiped - is closed by
// CLOSE_ROOM_IF_EMPTY_SCRIPT (redis-scripts.ts): it re-checks the peers hash
// is still empty and deletes it in one atomic server-side step, so a
// concurrent addPeer's HSET can't land in between.

// prefer
// A crashed instance never fires this, so a dead peer lingers until #7's
// TTL/liveness work lands - TTLs below are the safety net for now.
```
