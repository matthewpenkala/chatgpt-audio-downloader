# Validation record — 2026-10-11

Target: the owner's existing macOS Chrome profile and open ChatGPT conversation. Upstream baseline: `63c5effc28fa0e1646c75418c750b40c9978b160`, version 2.0. This record contains sanitized technical results; no conversation identifiers, request headers, tokens, text, or private recordings are included.

## Root cause observed

The old hook was installed and did intercept the current HTTPS `/backend-api/synthesize` GET request. Chrome DevTools reported HTTP 200 and `audio/aac`. It awaited `response.clone().blob()`, which resolves only when the entire network stream closes. Before that it supplied a Vietnamese loading button and no downloadable history entry. Stopping ChatGPT Read Aloud caused an `AbortError`; the old extension removed the button and discarded the received audio. This is an observed failure, not evidence that the endpoint had changed.

A separate short-response baseline measurement received 746,959 bytes in 123 chunks. First bytes arrived after 1.459 seconds; the complete response arrived after 10.839 seconds. Thus full playback was not required even in the old version if the response completed first. The earlier installation verified installation/pinning only; it had not established functional audio capture.

## Changes

- Complete English popup, page panel, metadata, statuses, instructions, and actionable errors.
- Native static `MAIN`-world injection at `document_start`; isolated popup/UI bridge with timeout and origin/source checks.
- Greedy stream draining with received-byte progress; complete response can be saved while playback continues. Site fetch promises/responses remain unaltered.
- Interrupted bytes retained as explicit partial recordings. Error/non-audio responses never masquerade as valid complete audio.
- User-initiated **Download full audio** replays the same GET request with its own `AbortController`, consumes that response directly, and initiates a download at EOF. ChatGPT's playback abort signal cannot terminate it. It is a second network request, not a bypass of server generation time.
- Bounded retained audio/history, explicit cancellation/clearing, duplicate pending full-fetch handling, validated file signatures, and keyboard-focus preservation during progress updates.

## Live acceptance checks

The extension was reloaded from its existing unpacked folder and the affected ChatGPT tab was reloaded. Version 3 hook and isolated page panel were both confirmed. The old version's global was absent, so the temporary timing instrumentation and old hooks were cleared.

A short response produced a complete capture in 5.035 seconds (first bytes after 1.028 seconds). **Save audio** downloaded an actual file while Read Aloud was still playing:

- 741,396 bytes; SHA-256 `dbe985666092655c4167996a052007941d6e65116c1fcfed7023923582e7ecf6`.
- AAC, 24,000 Hz, mono; 2,326 complete ADTS frames, zero trailing bytes.
- Exact duration from frame count: 99.243 seconds. `ffprobe`'s variable-bitrate duration estimate was 96.872 seconds; it is not the exact duration authority.
- Full decode with `ffmpeg -v error -i FILE -f null -` succeeded with no errors.

The long-response test invoked **Download full audio**, then stopped ChatGPT playback. The original request became a labeled 1,200,128-byte partial capture after 7.562 seconds. The independent request continued and automatically saved a complete file without restarting playback:

- Complete response received in 87.905 seconds; first bytes after 1.984 seconds.
- 11,532,255 bytes; SHA-256 `00d7c30ad5ddf3e565a45c7b4f57881062170d2b3a361c80f2bbbb8f31ad89eb`.
- AAC, 24,000 Hz, mono; 35,838 complete ADTS frames, zero trailing bytes.
- Frame-derived duration: 1,529.088 seconds (25 minutes 29.088 seconds); all frames contain one raw data block. The `ffprobe` variable-bitrate estimate was 1,820.367 seconds, so it was not used as exact runtime evidence.
- Downloaded byte count matched the capture's completed byte count. Full `ffmpeg` decode passed with no errors. The file existed in Chrome's Downloads directory before declaring success.

This directly establishes download completion in about 88 seconds for about 25.5 minutes of spoken material, with playback stopped. The measurements are examples, not a guaranteed server generation speed.

## Automated checks and review

Node syntax checks and the Node `node:test` suite are run locally; CI repeats both on Node 22. Tests use native stream/request/response primitives in a VM browser harness. They exercise exact bytes, fetch pass-through, endpoint/signature handling, failures, partial retention, independent signals, cancellations, clearing pending work, duplicate replay, message filtering, idempotence, and capacity limits.

A separate read-only reviewer identified the unread original-branch buffer in full fetches, incomplete cancellation on early full-fetch exits, premature retention eviction, focus loss on row updates, and confusing cancellation text. These were corrected before final publication.

AAC from this current ChatGPT endpoint is the live-supported transport. Helpers for other containers are unit tested, not a claim of live ChatGPT compatibility. End-to-end verification does not establish indefinite compatibility with future private API changes.
