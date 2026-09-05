# Meet Server

Signaling and media-forwarding backend for group video calls: clients join a call over WebSocket, negotiate WebRTC media through an SFU, and exchange chat over the same room.

## Language

**Room**:
A named call from the participants' point of view: who has joined, their display names, and which producers they've published. Owned by the `realtime` app. Holds no mediasoup objects.
_Avoid_: Call, meeting

**MediaRoom**:
The mediasoup-side counterpart to a **Room** — same id, but holds the `Router` and every peer's `WebRtcTransport`/`Producer`/`Consumer`. Owned by the `sfu` app. Has no concept of display names or "who is present."
_Avoid_: Room (when specifically meaning the mediasoup-object-holding side)

**Peer**:
One participant's presence in a **Room** — id, display name, and (from the realtime side) the ids of producers they've published. The `sfu` side tracks the same peer id but only to key its transports/producers/consumers, not identity.
_Avoid_: Participant, User, Client

**Session** (see issue #7):
The mapping of a **Room**'s id to the specific `sfu` instance holding that room's **MediaRoom**/`Router` — sticky routing, not peer liveness. TTL-refreshed by participant activity (coalesced updates), assigned once when a room's session is first created. Distinct from a **Peer**'s presence in a **Room**, which issue #6 makes independent of any single `realtime` instance.
_Avoid_: using "session" to mean a peer's connection/liveness — that concept still has no name (see issue #31), tracked separately from Session

**Instance Record** (see issue #8):
An `sfu` instance's self-published entry in Redis — its advertised URL and current load (active consumer count), heartbeat-refreshed with a TTL so a crashed instance's record simply expires. Exists independently of any **Room**; a **Session** is chosen *from* the set of live Instance Records at assignment time, but an Instance Record itself knows nothing about which rooms it holds.
_Avoid_: Session (reserved for the room→instance mapping), "registry entry" (say Instance Record instead, for consistency)

## Relationships

- A **Room** and a **MediaRoom** share the same id but live in different apps (`realtime` and `sfu` respectively) and are never the same object.
- A **Peer** belongs to exactly one **Room**; the **sfu** app tracks the same peer id to scope transports/producers/consumers, without knowing about display names or membership.

## Example dialogue

> **Dev:** "When a client joins, does the `Room` get the `Router` reference too?"
> **Domain expert:** "No — `Room` never touches mediasoup objects. It just tracks who's in the call. The `Router`, and everyone's transports/producers/consumers, live in the `MediaRoom`, over in the `sfu` app. `realtime` only ever holds ids for those."

## Flagged ambiguities

- "Room" was used for both the membership concept and the mediasoup-object-holding concept before the `sfu`/`realtime` split (issue #5) — resolved: **Room** (realtime, membership) and **MediaRoom** (sfu, mediasoup objects) are distinct.
- **MediaRoom**'s avoid-list previously claimed "Session" was reserved for peer connection/liveness, while **Session**'s own entry defined it as sfu-instance sticky routing and explicitly said liveness "doesn't have a name yet" — a stale contradiction from before Session was pinned down. Resolved while grilling issue #7: **Session** is sticky routing only; peer-liveness (a crashed `realtime` instance leaving a stale peer behind, independent of the room's own health) is separate, unnamed work now tracked as issue #31.
