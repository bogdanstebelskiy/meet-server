# No seamless mid-session sfu failover — rely on #34's rejoin-based recovery

#32 asked whether a room's live media should migrate to a new `sfu` instance with zero client-visible effect when its pinned instance dies mid-call, as an alternative to #34's "everyone rebuilds their media" recovery.

Rejected for now, on the three open questions #32 itself posed:

- **Is it worth it given #34 already exists?** #34's recovery is bounded to the one affected room, keeps the WS connection and room membership untouched, and only rebuilds mediasoup state (transports/producers/consumers) — it was never a full client rejoin. The remaining gap between that and "seamless" is a brief media freeze during rebuild, not a dropped call. No load-test or production evidence exists that this gap is unacceptable.
- **Is `pipeToRouter` usable for this?** Technically yes — mediasoup's `PipeTransport` supports piping across hosts, not just workers on one process. But `docs/sfu-signaling-design.md`'s own "Deferred until there's a concrete need" section already defers `pipeToRouter`/multi-worker rooms until load-testing shows single-worker capacity is actually the bottleneck. Reaching for it here, for a different problem (cross-instance failover) with equally no measured need, repeats the same premature-optimization mistake the doc already warns against.
- **Is "seamless" actually achievable?** No, not fully: ICE/DTLS state is peer-local, so a client still needs new ICE candidates for a migrated router regardless of what mediasoup does server-side. "Seamless" was always going to mean "no client rejoin," not "the client does nothing" — and #34's media-rebuild broadcast already delivers exactly that.

## Consequences

Revisit if production usage shows #34's media-rebuild recovery is disruptive enough that users notice/complain, or once real load-testing (the same trigger that would justify `pipeToRouter` for capacity reasons) produces concrete numbers to design against instead of speculation.
