# ChatGPT Audio Downloader

English Chrome extension for saving ChatGPT **Read Aloud** audio directly from its network response. This fork refactors the original v2 extension by [jsc2017605097](https://github.com/jsc2017605097/chatgpt-audio-downloader).

## Use

1. Open a conversation at `https://chatgpt.com` and click **Read Aloud** on the response you want.
2. The page panel and toolbar popup show incoming bytes and capture status.
3. When **Complete audio ready** appears, choose **Save audio**. You can save immediately; playback does not need to finish.
4. To stop listening before the transfer finishes, choose **Download full audio**, then stop ChatGPT playback. The extension makes an independent request for that same audio and saves it automatically when the response completes. Keep the ChatGPT tab open. Closing the popup is fine.
5. **Save partial** explicitly saves only bytes received so far. Interrupted recordings are labeled partial and never presented as complete.

**Download full audio** is a separate same-origin request, not a microphone recording. It can involve a second synthesis request; it cannot force ChatGPT's server to generate audio faster. Requests for the same in-progress full recording are deduplicated. **Cancel full fetch** stops that independent transfer. Completed captures use their existing bytes instead of requesting them again.

## Install or update

Download the release ZIP and extract it to a permanent folder, or clone this repository. In `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`. Pin **ChatGPT Audio Downloader** in Chrome's Extensions menu. Reload already-open ChatGPT tabs once.

For subsequent updates, replace the extension files in that same folder, click its **Reload** button in `chrome://extensions`, and reload the ChatGPT tab. Moving/deleting the installed folder breaks an unpacked installation. This is not a Chrome Web Store installation and has no automatic updater.

## Behavior and privacy

- Captures the HTTPS `chatgpt.com/backend-api/synthesize` GET endpoint observed in live testing. It does not request unrelated endpoints or alter the site's original request/response.
- Drains incoming audio independently of playback speed. AAC is verified live; helpers also recognize MP3, Ogg, WAV, M4A, and WebM signatures, but those transports have not been verified against live ChatGPT.
- Native Manifest V3 `MAIN`-world injection at `document_start` installs the fetch hook. The isolated content script supplies the UI and popup bridge. Chrome 111 or newer is required. See [Chrome's content-script manifest documentation](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts).
- No analytics, external server, upload, API key, or persistent audio storage. Request credentials needed for the optional same-origin replay stay inside the page hook's closure and are never included in popup metadata or logs.
- History is kept in the current tab until reloaded, closed, or cleared. It remains across normal ChatGPT navigation within the tab. **Clear tab recordings** also cancels active extension-owned full transfers.
- Limits: four concurrent captures, twenty retained records, 128 MiB per recording, and 256 MiB of retained audio. Older completed records may be evicted. Browser stream buffers and temporary download snapshots are additional memory; this is not a total browser RAM cap.
- MIME and file signatures are checked; failed, empty, or non-audio responses are not silently downloaded as AAC. Partial audio containers can have an incomplete final frame and may need tolerant media software.
- The extension never bypasses account access, subscription requirements, server rate limits, or generation latency. If ChatGPT changes its private endpoint, capture may need another update. Voice mode and microphone conversations are outside the tested scope.

## Development

No dependencies or build step. Node 22+:

```sh
npm run check
npm test
```

Tests exercise real `Request`, `Response`, and `ReadableStream` objects in a VM browser harness. They cover byte preservation, original fetch pass-through, partial retention, full replay after playback abort, cancellations, limits, bridge filtering, and failed responses. Browser installation and real downloads require the separate manual/live checks described in `docs/validation.md`.

The upstream repository did not include a license file at the inspected commit. This fork preserves its history and attribution and does not assign a new license to upstream material.
