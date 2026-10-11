/* Runs synchronously in Chrome's MAIN world at document_start. */
(() => {
  'use strict';
  const marker = '__chatgptAudioDownloaderV3';
  if (window[marker]) return;
  Object.defineProperty(window, marker, {value: true});
  const core = globalThis.ChatGPTAudioCore;
  const originalFetch = window.fetch;
  const channel = 'chatgpt-audio-downloader:v3';
  const MAX_FILE = 128 * 1024 * 1024;
  const MAX_TOTAL = 256 * 1024 * 1024;
  const MAX_ITEMS = 20;
  const MAX_ACTIVE = 4;
  const entries = new Map();
  let lastNotification = 0;
  let notificationTimer;
  let sequence = 0;
  function active(item) { return item.status === 'waiting' || item.status === 'capturing'; }
  function metadata(item) {
    const partial = item.status !== 'ready';
    return {id: item.id, createdAt: item.createdAt, status: item.status,
      source: item.source, bytes: item.bytes, chunks: item.chunkCount,
      elapsedMs: (item.finishedAt || Date.now()) - item.createdAt,
      firstByteMs: item.firstByteAt ? item.firstByteAt - item.createdAt : null,
      mime: item.mime, extension: item.extension, error: item.error,
      canDownload: !!item.extension && item.bytes > 0,
      canFetchFull: !!item.template && item.status !== 'ready' && (item.source !== 'full' || !active(item)),
      canCancel: item.source === 'full' && active(item),
      filename: item.extension ? core.filename(item.createdAt, item.id, item.extension, partial) : null};
  }
  function state() { return {version: '3.0.0', ready: true, audios: [...entries.values()].map(metadata)}; }
  function notify(force = false) {
    if (!force && Date.now() - lastNotification < 500) {
      notificationTimer ??= setTimeout(() => { notificationTimer = undefined; notify(true); }, 500);
      return;
    }
    clearTimeout(notificationTimer); notificationTimer = undefined;
    lastNotification = Date.now();
    window.postMessage({channel, type: 'update', state: state()}, location.origin);
  }
  function memoryUsed() { return [...entries.values()].reduce((n, item) => n + item.bytes, 0); }
  function drop(item) {
    entries.delete(item.id);
    item.discarded = true;
    item.controller?.abort();
    if (item.reader) void item.reader.cancel().catch(() => {});
    item.chunks = []; item.blob = null; item.template = null;
  }
  function makeRoom(additionalBytes = 0, reserveSlot = false) {
    while (entries.size + (reserveSlot ? 1 : 0) > MAX_ITEMS || memoryUsed() + additionalBytes > MAX_TOTAL) {
      const candidate = [...entries.values()].find(item => !active(item));
      if (!candidate) return false;
      drop(candidate);
    }
    return true;
  }
  function start(source, template, key) {
    if ([...entries.values()].filter(active).length >= MAX_ACTIVE || !makeRoom(0, true)) return null;
    const item = {id: `audio_${Date.now()}_${++sequence}`, createdAt: Date.now(),
      status: 'waiting', source, template, key, bytes: 0, chunkCount: 0,
      chunks: [], prefix: new Uint8Array(), extension: null, mime: '', error: null};
    entries.set(item.id, item); notify(true); return item;
  }
  function download(item, allowPartial = true) {
    if (!item.extension || !item.bytes || (!allowPartial && item.status !== 'ready')) throw new Error('No valid audio is ready to save.');
    const partial = item.status !== 'ready';
    const blob = item.blob || new Blob(item.chunks, {type: item.mime || 'audio/aac'});
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = core.filename(item.createdAt, item.id, item.extension, partial);
    (document.body || document.documentElement).appendChild(anchor);
    anchor.click(); anchor.remove();
    // Do not revoke while Chrome is still resolving the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }
  function finish(item, error) {
    if (item.discarded) return;
    item.finishedAt = Date.now();
    item.error = error || null;
    if (!item.bytes) { item.status = 'error'; item.error ||= 'The response contained no audio. Try Read Aloud again.'; }
    else if (!item.extension) {
      item.status = 'error'; item.error = 'The response was not a recognized audio file.';
      item.bytes = 0; item.chunks = [];
    } else {
      item.blob = new Blob(item.chunks, {type: item.mime}); item.chunks = [];
      item.status = error ? 'partial' : 'ready';
    }
    if (item.error && item.source === 'full') item.controller?.abort();
    item.reader = null;
    notify(true);
    if (item.autoDownload && item.status === 'ready') {
      try { download(item, false); } catch { item.error = 'Audio is ready. Use Save audio to retry the download.'; notify(true); }
    }
  }
  async function capture(response, item) {
    if (item.discarded) return;
    if (!response.ok) { finish(item, `ChatGPT returned HTTP ${response.status}. Try Read Aloud again.`); return; }
    item.mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!response.body) { finish(item, 'This response has no audio stream.'); return; }
    if (!item.mime.startsWith('audio/') && !['application/octet-stream', 'application/ogg', ''].includes(item.mime)) {
      finish(item, 'ChatGPT returned a non-audio response. Try Read Aloud again.'); return;
    }
    try {
      // Drain the duplicate stream immediately, independent of playback speed.
      item.reader = (item.source === 'full' ? response : response.clone()).body.getReader();
      item.status = 'capturing'; notify(true);
      while (!item.discarded) {
        const {done, value} = await item.reader.read();
        if (done) break;
        if (item.discarded) return;
        if (!value?.byteLength) continue;
        if (item.bytes + value.byteLength > MAX_FILE || !makeRoom(value.byteLength)) {
          void item.reader.cancel().catch(() => {});
          finish(item, 'Capture reached the memory limit. Only the received portion is available.'); return;
        }
        item.firstByteAt ??= Date.now();
        item.bytes += value.byteLength; item.chunkCount++;
        item.chunks.push(value);
        if (item.prefix.length < 16) {
          const prefix = new Uint8Array(Math.min(16, item.prefix.length + value.length));
          prefix.set(item.prefix); prefix.set(value.subarray(0, prefix.length - item.prefix.length), item.prefix.length);
          item.prefix = prefix;
          item.extension = core.formatFor(item.mime, prefix);
        }
        notify();
      }
      finish(item);
    } catch (error) {
      finish(item, error?.name === 'AbortError'
        ? (item.source === 'full' ? 'Full recording fetch cancelled. Only the received portion is available.' : 'Playback stopped before the response finished. Save the partial audio or fetch the full recording.')
        : (item.source === 'full' ? 'The full audio transfer was interrupted. Retry the full download.' : 'The audio stream was interrupted. Save the received portion or try fetching the full recording.'));
    }
  }
  window.fetch = function(...args) {
    let item;
    try {
      const url = core.audioRequest(args[0], location.href);
      if (url) {
        // Keep request credentials only in this closure for same-origin, user-initiated replay.
        // Never publish headers, URLs, message text, or tokens in the bridge or logs.
        const template = new Request(args[0], args[1]);
        if (template.method === 'GET') item = start('playback', template, url.href);
      }
    } catch { /* Inspection must never prevent the site's own fetch. */ }
    let promise;
    try { promise = originalFetch.apply(this, args); }
    catch (error) { if (item) finish(item, 'Read Aloud could not start. Try again.'); throw error; }
    if (item) void promise.then(response => capture(response, item), error => finish(item,
      error?.name === 'AbortError' ? 'Playback stopped before any audio arrived.' : 'Read Aloud failed to start. Try again.'));
    return promise;
  };
  async function fetchFull(id) {
    const previous = entries.get(id);
    if (!previous?.template) throw new Error('Start Read Aloud once to make a full recording available.');
    if (previous.status === 'ready') {
      download(previous, false);
      return {id: previous.id, message: 'Complete audio is already available. Download requested.'};
    }
    const existing = [...entries.values()].find(item => item.key === previous.key && item.source === 'full' && active(item));
    if (existing) return {id: existing.id, message: 'The full recording is already being fetched.'};
    const controller = new AbortController();
    // A fresh signal keeps this transfer alive if ChatGPT stops its playback request.
    const request = new Request(previous.template, {signal: controller.signal});
    const item = start('full', previous.template, previous.key);
    if (!item) throw new Error('Too many recordings are in progress. Wait or cancel a full fetch.');
    item.controller = controller; item.autoDownload = true;
    try {
      void originalFetch.call(window, request).then(response => capture(response, item), error => finish(item,
        error?.name === 'AbortError' ? 'Full recording fetch cancelled.' : 'Full recording request failed. Start Read Aloud again and retry.'));
    } catch { finish(item, 'Full recording request failed. Start Read Aloud again and retry.'); throw new Error(item.error); }
    return {id: item.id, message: 'Fetching the full recording. Playback can be stopped. Chrome will save the file when the response finishes.'};
  }
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel || event.data?.type !== 'request') return;
    const {requestId, action, id} = event.data;
    if (typeof requestId !== 'string' || requestId.length > 100) return;
    let result;
    try {
      switch (action) {
        case 'STATE': result = state(); break;
        case 'DOWNLOAD': {
          const item = entries.get(id); if (!item) throw new Error('This recording is no longer available.');
          download(item); result = {message: 'Download requested. Check Chrome Downloads.'}; break;
        }
        case 'FULL': result = await fetchFull(id); break;
        case 'CANCEL': {
          const item = entries.get(id);
          if (!item?.controller || !active(item)) throw new Error('No full recording fetch is in progress.');
          item.controller.abort(); result = {message: 'Full recording fetch cancelled.'}; break;
        }
        case 'CLEAR': for (const item of [...entries.values()]) drop(item); notify(true); result = {message: 'Tab recordings cleared.'}; break;
        default: throw new Error('Unknown action.');
      }
      window.postMessage({channel, type: 'response', requestId, result}, location.origin);
    } catch (error) {
      window.postMessage({channel, type: 'response', requestId, error: error.message}, location.origin);
    }
  });
  notify(true);
})();
