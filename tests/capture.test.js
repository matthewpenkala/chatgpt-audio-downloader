'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../capture-core.js');
const hookSource = fs.readFileSync(path.join(__dirname, '../inject.js'), 'utf8');
const CHANNEL = 'chatgpt-audio-downloader:v3';
const ENDPOINT = 'https://chatgpt.com/backend-api/synthesize?message_id=fixture';
const AAC = Uint8Array.of(255, 241, 80, 128, 1, 127, 252, 21, 22, 23, 24);
const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function streamResponse(chunks, options = {}) {
  const stream = new ReadableStream({start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  }});
  return new Response(stream, {headers: {'content-type': 'audio/aac'}, ...options});
}
function controlledResponse(signal) {
  let controller;
  const body = new ReadableStream({start(value) { controller = value; }});
  if (signal) signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), {once: true});
  return {response: new Response(body, {headers: {'content-type': 'audio/aac'}}),
    enqueue: value => controller.enqueue(value), close: () => controller.close(), fail: error => controller.error(error)};
}
function harness(fetchImpl = () => Promise.resolve(streamResponse([AAC])), options = {}) {
  const posts = [], downloads = [], listeners = [], timers = new Map(), blobs = new Map();
  let timerId = 0, requestId = 0;
  class BrowserURL extends URL {
    static createObjectURL(blob) { const id = `blob:fixture-${blobs.size}`; blobs.set(id, blob); return id; }
    static revokeObjectURL(id) { blobs.delete(id); }
  }
  class BrowserRequest extends Request {
    constructor(input, init) {
      super(typeof input === 'string' ? new URL(input, 'https://chatgpt.com/').href : input, init);
    }
  }
  const window = {
    fetch: fetchImpl,
    postMessage: (data, origin) => posts.push({data, origin}),
    addEventListener: (type, callback) => { if (type === 'message') listeners.push(callback); }
  };
  const document = {
    body: {appendChild() {}},
    createElement: () => ({click() { downloads.push({blob: blobs.get(this.href), filename: this.download}); }, remove() {}})
  };
  const sandbox = vm.createContext({window, document, location: {origin: 'https://chatgpt.com', href: 'https://chatgpt.com/c/fixture'},
    ChatGPTAudioCore: core, URL: BrowserURL, Request: BrowserRequest, Response, Uint8Array, Blob, AbortController,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, {callback, delay}); return id; }, clearTimeout: id => timers.delete(id)});
  let source = hookSource;
  if (options.scaledQuota) {
    // Divide both byte quotas by 1 MiB. The ratio and branch behavior remain
    // identical, while aggregate-pressure tests avoid retaining 300 MiB.
    assert.match(source, /const MAX_FILE = 128 \* 1024 \* 1024;/);
    assert.match(source, /const MAX_TOTAL = 256 \* 1024 \* 1024;/);
    source = source.replace('const MAX_FILE = 128 * 1024 * 1024;', 'const MAX_FILE = 128;')
      .replace('const MAX_TOTAL = 256 * 1024 * 1024;', 'const MAX_TOTAL = 256;');
  }
  const install = () => vm.runInContext(source, sandbox, {filename: 'inject.js'});
  install();
  const state = () => posts.filter(post => post.data.type === 'update').at(-1).data.state;
  async function dispatch(data, source = window, origin = 'https://chatgpt.com') {
    await Promise.all(listeners.map(listener => listener({data, source, origin})));
  }
  async function request(action, id) {
    const key = `test-${++requestId}`;
    await dispatch({channel: CHANNEL, type: 'request', requestId: key, action, id});
    return posts.find(post => post.data.type === 'response' && post.data.requestId === key)?.data;
  }
  async function until(predicate) {
    for (let i = 0; i < 60; i++) {
      for (const [id, timer] of timers) if (timer.delay <= 500) { timers.delete(id); timer.callback(); }
      if (predicate()) return; await tick();
    }
    assert.fail('Capture did not reach the expected state');
  }
  return {window, posts, downloads, listeners, timers, install, state, dispatch, request, until};
}

test('request matching accepts only the exact same-origin synthesis path', () => {
  for (const value of [ENDPOINT, '/backend-api/synthesize', '/backend-api/synthesize/?x=1', new URL(ENDPOINT), new Request(ENDPOINT)]) {
    assert.ok(core.audioRequest(value, 'https://chatgpt.com/c/fixture'));
  }
  for (const value of ['https://evil.test/backend-api/synthesize', 'http://chatgpt.com/backend-api/synthesize',
    'https://chatgpt.com.evil.test/backend-api/synthesize', '/backend-api/synthesize-more', '/backend-api/synthesize/nested',
    '/other/backend-api/synthesize', 'https://chatgpt.com:444/backend-api/synthesize', 'not a url']) {
    assert.equal(core.audioRequest(value, 'https://chatgpt.com/c/fixture'), null, String(value));
  }
});

test('format detection checks actual signatures and generates format-specific filenames', () => {
  const fixtures = [
    ['aac', 'audio/aac', AAC], ['aac', 'audio/aacp', AAC],
    ['mp3', 'audio/mpeg', Buffer.from('ID3fixture')], ['mp3', 'audio/mp3', Uint8Array.of(255, 251, 144, 0)],
    ['ogg', 'application/ogg', Buffer.from('OggSfixture')], ['ogg', 'audio/ogg', Buffer.from('OggSfixture')],
    ['wav', 'audio/x-wav', Buffer.from('RIFF0000WAVEfixture')],
    ['m4a', 'audio/mp4', Buffer.from('0000ftypfixture')], ['m4a', 'audio/x-m4a', Buffer.from('0000ftypfixture')],
    ['webm', 'audio/webm', Uint8Array.of(26, 69, 223, 163, 0)]
  ];
  for (const [extension, mime, bytes] of fixtures) {
    assert.equal(core.sniff(bytes), extension);
    assert.equal(core.formatFor(`${mime.toUpperCase()}; codec=test`, bytes), extension);
    assert.equal(core.formatFor('application/octet-stream', bytes), extension);
    assert.equal(core.formatFor('', bytes), extension);
    assert.match(core.filename('2026-10-11T12:34:56.000Z', 'audio_fixture123', extension), new RegExp(`\\.${extension}$`));
  }
  for (const bytes of [new Uint8Array(), Buffer.from('<html>error</html>'), Buffer.from('{"error":"denied"}')]) {
    assert.equal(core.formatFor('audio/aac', bytes), null);
  }
  assert.equal(core.formatFor('text/html', AAC), null);
  assert.equal(core.filename('2026-10-11T12:34:56.000Z', 'audio_fixture123', 'aac', true), 'ChatGPT_Audio_2026-10-11T12-34-56-000Z_xture123-partial.aac');
});

test('fetch returns the identical promise and response while independently draining exact AAC bytes', async () => {
  const response = streamResponse([AAC.subarray(0, 2), AAC.subarray(2, 7), AAC.subarray(7)]);
  const originalPromise = Promise.resolve(response);
  let passedArgs, receiver;
  const h = harness(function(...args) { passedArgs = args; receiver = this; return originalPromise; });
  const init = {headers: {'x-fixture': 'test'}};
  const result = h.window.fetch('/backend-api/synthesize?message_id=fixture', init);
  assert.strictEqual(result, originalPromise);
  assert.strictEqual(await result, response);
  assert.deepEqual(passedArgs, ['/backend-api/synthesize?message_id=fixture', init]);
  assert.strictEqual(receiver, h.window);
  await h.until(() => h.state().audios[0]?.status === 'ready');
  const item = h.state().audios[0];
  assert.equal(item.bytes, AAC.length);
  assert.equal(item.chunks, 3);
  assert.equal(item.extension, 'aac');
  assert.equal(h.downloads.length, 0);
  assert.equal((await h.request('DOWNLOAD', item.id)).error, undefined);
  assert.deepEqual(new Uint8Array(await h.downloads[0].blob.arrayBuffer()), AAC);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), AAC);
  assert.match(h.downloads[0].filename, /\.aac$/);
  assert.doesNotMatch(h.downloads[0].filename, /partial/);
});

test('unrelated requests and POST synthesis calls are passed through without entries', async () => {
  const calls = [];
  const h = harness((...args) => { calls.push(args); return Promise.resolve(new Response('ok')); });
  await h.window.fetch('https://example.test/backend-api/synthesize');
  await h.window.fetch('/backend-api/synthesize', {method: 'POST'});
  assert.equal(calls.length, 2);
  assert.equal(h.state().audios.length, 0);
});

test('fetch rejections and synchronous throws preserve the original failure', async () => {
  const rejection = new Error('fixture network failure');
  const promise = Promise.reject(rejection);
  const h = harness(() => promise);
  const result = h.window.fetch(ENDPOINT);
  assert.strictEqual(result, promise);
  await assert.rejects(result, error => error === rejection);
  await h.until(() => h.state().audios[0]?.status === 'error');
  assert.equal(h.state().audios[0].canDownload, false);
  const h2 = harness(() => { throw rejection; });
  assert.throws(() => h2.window.fetch(ENDPOINT), error => error === rejection);
  assert.equal(h2.state().audios[0].status, 'error');
});

test('HTTP errors, empty, absent-body, and non-audio responses cannot be saved', async t => {
  const fixtures = [
    ['HTTP failure', new Response('failure', {status: 503})],
    ['empty audio', streamResponse([])],
    ['absent body', new Response(null, {headers: {'content-type': 'audio/aac'}})],
    ['non-audio MIME', new Response(AAC, {headers: {'content-type': 'text/html'}})],
    ['invalid audio bytes', streamResponse([Buffer.from('not audio bytes')])]
  ];
  for (const [name, response] of fixtures) await t.test(name, async () => {
    const h = harness(() => Promise.resolve(response));
    await h.window.fetch(ENDPOINT);
    await h.until(() => h.state().audios[0]?.status === 'error');
    const item = h.state().audios[0];
    assert.equal(item.canDownload, false);
    assert.ok(item.error);
    assert.ok((await h.request('DOWNLOAD', item.id)).error);
    assert.equal(h.downloads.length, 0);
  });
});

test('an interrupted stream keeps an exact downloadable partial recording', async () => {
  const controlled = controlledResponse();
  const h = harness(() => Promise.resolve(controlled.response));
  await h.window.fetch(ENDPOINT);
  controlled.enqueue(AAC);
  await h.until(() => h.state().audios[0]?.canDownload);
  controlled.fail(new DOMException('Aborted', 'AbortError'));
  await h.until(() => h.state().audios[0]?.status === 'partial');
  const item = h.state().audios[0];
  assert.equal(item.bytes, AAC.length);
  assert.match(item.error, /Playback stopped/);
  assert.equal((await h.request('DOWNLOAD', item.id)).error, undefined);
  assert.deepEqual(new Uint8Array(await h.downloads[0].blob.arrayBuffer()), AAC);
  assert.match(h.downloads[0].filename, /-partial\.aac$/);
});

test('FULL uses an independent signal, deduplicates pending replay, survives playback abort, and saves immediately on completion', async () => {
  const originalController = new AbortController();
  const playback = controlledResponse(originalController.signal);
  const full = controlledResponse();
  const calls = [];
  const h = harness((input, init) => {
    calls.push({input, init});
    return Promise.resolve(calls.length === 1 ? playback.response : full.response);
  });
  const request = new Request(ENDPOINT, {signal: originalController.signal, credentials: 'include', headers: {'x-fixture': 'preserved'}});
  await h.window.fetch(request);
  const playbackId = h.state().audios[0].id;
  const result = await h.request('FULL', playbackId);
  const fullId = result.result.id;
  const replay = calls[1].input;
  assert.equal(replay.url, request.url);
  assert.equal(replay.credentials, request.credentials);
  assert.equal(replay.headers.get('x-fixture'), 'preserved');
  assert.notStrictEqual(replay.signal, request.signal);
  assert.equal(replay.signal.aborted, false);
  const duplicate = await h.request('FULL', playbackId);
  assert.equal(duplicate.result.id, fullId);
  assert.equal(calls.length, 2);
  const selfDuplicate = await h.request('FULL', fullId);
  assert.equal(selfDuplicate.result.id, fullId);
  assert.equal(calls.length, 2);
  originalController.abort();
  assert.equal(request.signal.aborted, true);
  assert.equal(replay.signal.aborted, false);
  full.enqueue(AAC.subarray(0, 7)); full.enqueue(AAC.subarray(7)); full.close();
  await h.until(() => h.state().audios.find(item => item.id === fullId)?.status === 'ready');
  assert.equal(h.downloads.length, 1);
  assert.deepEqual(new Uint8Array(await h.downloads[0].blob.arrayBuffer()), AAC);
  assert.doesNotMatch(h.downloads[0].filename, /partial/);
  const savedAgain = await h.request('FULL', fullId);
  assert.equal(savedAgain.result.id, fullId);
  assert.equal(calls.length, 2);
  assert.equal(h.state().audios.length, 2);
  assert.equal(h.downloads.length, 2);
  assert.deepEqual(new Uint8Array(await h.downloads[1].blob.arrayBuffer()), AAC);
});

test('CLEAR removes pending captures and prevents late responses from restoring entries or saving', async () => {
  const playback = deferred(), full = deferred();
  let calls = 0, replay;
  const h = harness(input => { calls++; if (calls === 1) return playback.promise; replay = input; return full.promise; });
  h.window.fetch(ENDPOINT);
  const playbackId = h.state().audios[0].id;
  await h.request('FULL', playbackId);
  assert.equal(h.state().audios.length, 2);
  await h.request('CLEAR');
  assert.equal(replay.signal.aborted, true);
  assert.equal(h.state().audios.length, 0);
  playback.resolve(streamResponse([AAC])); full.resolve(streamResponse([AAC]));
  await tick(); await tick();
  assert.equal(h.state().audios.length, 0);
  assert.equal(h.downloads.length, 0);
  assert.ok((await h.request('DOWNLOAD', playbackId)).error);
});

test('CANCEL aborts a full replay and preserves received partial bytes', async () => {
  let calls = 0, replay;
  const playback = controlledResponse().response;
  let full;
  const h = harness(input => {
    if (++calls === 1) return Promise.resolve(playback);
    if (calls === 3) return Promise.resolve(streamResponse([AAC]));
    replay = input; full = controlledResponse(input.signal); return Promise.resolve(full.response);
  });
  await h.window.fetch(ENDPOINT);
  await h.until(() => h.state().audios[0]?.status === 'capturing');
  const fullId = (await h.request('FULL', h.state().audios[0].id)).result.id;
  full.enqueue(AAC);
  await h.until(() => h.state().audios.find(item => item.id === fullId)?.bytes === AAC.length);
  assert.equal((await h.request('CANCEL', fullId)).error, undefined);
  assert.equal(replay.signal.aborted, true);
  await h.until(() => h.state().audios.find(item => item.id === fullId)?.status === 'partial');
  assert.match(h.state().audios.find(item => item.id === fullId).error, /Full recording fetch cancelled/);
  assert.equal(h.downloads.length, 0);
  assert.ok((await h.request('CANCEL', fullId)).error);
  const retry = await h.request('FULL', fullId);
  assert.equal(retry.error, undefined);
  assert.notEqual(retry.result.id, fullId);
  assert.equal(calls, 3);
  await h.until(() => h.state().audios.find(item => item.id === retry.result.id)?.status === 'ready');
  assert.equal(h.downloads.length, 1);
  assert.deepEqual(new Uint8Array(await h.downloads[0].blob.arrayBuffer()), AAC);
});

test('message bridge filters foreign sources, origins, channels, types, and invalid request IDs', async () => {
  const h = harness();
  const valid = {channel: CHANNEL, type: 'request', requestId: 'filtered', action: 'STATE'};
  const initialPosts = h.posts.length;
  await h.dispatch(valid, {});
  await h.dispatch(valid, h.window, 'https://evil.test');
  await h.dispatch({...valid, channel: 'foreign'});
  await h.dispatch({...valid, type: 'update'});
  await h.dispatch({...valid, requestId: 23});
  await h.dispatch({...valid, requestId: 'x'.repeat(101)});
  assert.equal(h.posts.length, initialPosts);
  assert.equal((await h.request('STATE')).result.ready, true);
  assert.match((await h.request('UNKNOWN')).error, /Unknown action/);
  assert.ok(h.posts.every(post => post.origin === 'https://chatgpt.com'));
  assert.doesNotMatch(JSON.stringify(h.posts), /message_id|x-fixture/);
});

test('hook installation is idempotent', () => {
  const h = harness();
  const installedFetch = h.window.fetch;
  const posts = h.posts.length;
  h.install();
  assert.strictEqual(h.window.fetch, installedFetch);
  assert.equal(h.listeners.length, 1);
  assert.equal(h.posts.length, posts);
});

test('active capture limit still passes all original requests through and entries stay bounded', async () => {
  const pending = [];
  const h = harness(() => { const item = deferred(); pending.push(item); return item.promise; });
  for (let i = 0; i < 5; i++) h.window.fetch(`${ENDPOINT}-${i}`);
  assert.equal(pending.length, 5);
  assert.equal(h.state().audios.length, 4);
  for (const item of pending) item.resolve(streamResponse([AAC]));
  await h.until(() => h.state().audios.every(item => item.status === 'ready'));
  for (let i = 0; i < 23; i++) {
    h.window.fetch(`${ENDPOINT}-completed-${i}`);
    pending.at(-1).resolve(streamResponse([AAC]));
    await h.until(() => h.state().audios.every(item => item.status === 'ready'));
  }
  assert.ok(h.state().audios.length <= 20);
  assert.ok(h.state().audios.length > 0);
});

test('synchronous FULL fetch failure leaves a terminal error rather than a stuck pending transfer', async () => {
  let calls = 0;
  const h = harness(() => { if (++calls === 1) return Promise.resolve(controlledResponse().response); throw new TypeError('fixture fetch failure'); });
  await h.window.fetch(ENDPOINT);
  await h.until(() => h.state().audios[0]?.status === 'capturing');
  const result = await h.request('FULL', h.state().audios[0].id);
  assert.match(result.error, /Full recording request failed/);
  assert.equal(result.result, undefined);
  const full = h.state().audios.find(item => item.source === 'full');
  assert.equal(full.status, 'error');
  assert.equal(full.canCancel, false);
});

test('per-file memory limit rejects an oversized chunk and preserves only accepted audio bytes', async () => {
  const controlled = controlledResponse();
  const h = harness(() => Promise.resolve(controlled.response));
  await h.window.fetch(ENDPOINT);
  controlled.enqueue(AAC);
  await h.until(() => h.state().audios[0]?.bytes === AAC.length);
  // The synthetic buffer is never copied into the retained recording: its size
  // exceeds MAX_FILE after the accepted header, so the reader must be cancelled.
  controlled.enqueue(new Uint8Array(128 * 1024 * 1024));
  await h.until(() => h.state().audios[0]?.status === 'partial');
  const item = h.state().audios[0];
  assert.equal(item.bytes, AAC.length);
  assert.equal(item.chunks, 1);
  assert.match(item.error, /memory limit/);
  await h.request('DOWNLOAD', item.id);
  assert.deepEqual(new Uint8Array(await h.downloads[0].blob.arrayBuffer()), AAC);
});

test('FULL can start after the original playback request has already been aborted', async () => {
  const originalController = new AbortController();
  originalController.abort();
  const abortedPromise = Promise.reject(new DOMException('Aborted', 'AbortError'));
  let calls = 0, replay;
  const h = harness(input => {
    if (++calls === 1) return abortedPromise;
    replay = input;
    return Promise.resolve(streamResponse([AAC]));
  });
  await assert.rejects(h.window.fetch(new Request(ENDPOINT, {signal: originalController.signal})), {name: 'AbortError'});
  await h.until(() => h.state().audios[0]?.status === 'error');
  const response = await h.request('FULL', h.state().audios[0].id);
  assert.equal(response.error, undefined);
  assert.equal(replay.signal.aborted, false);
  await h.until(() => h.state().audios.find(item => item.source === 'full')?.status === 'ready');
  assert.equal(h.downloads.length, 1);
  assert.deepEqual(new Uint8Array(await h.downloads[0].blob.arrayBuffer()), AAC);
});

test('failed FULL fetch becomes terminal and does not auto-save or block a retry', async () => {
  let calls = 0;
  const h = harness(() => ++calls === 1 ? Promise.resolve(controlledResponse().response) : Promise.reject(new Error('fixture failure')));
  await h.window.fetch(ENDPOINT);
  await h.until(() => h.state().audios[0]?.status === 'capturing');
  const playbackId = h.state().audios[0].id;
  const fullId = (await h.request('FULL', playbackId)).result.id;
  await h.until(() => h.state().audios.find(item => item.id === fullId)?.status === 'error');
  const item = h.state().audios.find(item => item.id === fullId);
  assert.equal(item.canCancel, false);
  assert.equal(item.canDownload, false);
  assert.equal(h.downloads.length, 0);
  const retryId = (await h.request('FULL', fullId)).result.id;
  assert.notEqual(retryId, fullId);
  assert.equal(calls, 3);
});

function quotaChunk(size, fill) {
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set(AAC);
  return bytes;
}

test('aggregate quota evicts the oldest terminal capture and preserves newer exact bytes (MiB-scaled)', async () => {
  const chunks = [quotaChunk(100, 1), quotaChunk(100, 2), quotaChunk(100, 3)];
  let calls = 0;
  const h = harness(() => Promise.resolve(streamResponse([chunks[calls++]])), {scaledQuota: true});
  const ids = [];
  for (let i = 0; i < chunks.length; i++) {
    await h.window.fetch(`${ENDPOINT}-${i}`);
    await h.until(() => h.state().audios.every(item => item.status === 'ready'));
    ids.push(h.state().audios.at(-1).id);
  }
  assert.deepEqual(Array.from(h.state().audios, item => item.id), ids.slice(1));
  assert.equal(h.state().audios.reduce((total, item) => total + item.bytes, 0), 200);
  assert.ok((await h.request('DOWNLOAD', ids[0])).error);
  for (let i = 1; i < ids.length; i++) {
    assert.equal((await h.request('DOWNLOAD', ids[i])).error, undefined);
    assert.deepEqual(new Uint8Array(await h.downloads.at(-1).blob.arrayBuffer()), chunks[i]);
  }
});

test('aggregate quota cannot evict active streams and preserves accepted partial bytes (MiB-scaled)', async () => {
  const streams = [controlledResponse(), controlledResponse(), controlledResponse()];
  let calls = 0;
  const h = harness(() => Promise.resolve(streams[calls++].response), {scaledQuota: true});
  for (let i = 0; i < streams.length; i++) await h.window.fetch(`${ENDPOINT}-${i}`);
  streams[0].enqueue(quotaChunk(100, 1));
  streams[1].enqueue(quotaChunk(100, 2));
  streams[2].enqueue(AAC);
  await h.until(() => h.state().audios.every(item => item.bytes > 0));
  const partialId = h.state().audios[2].id;
  streams[2].enqueue(quotaChunk(55, 3));
  await h.until(() => h.state().audios[2].status === 'partial');
  assert.equal(h.state().audios.length, 3);
  assert.deepEqual(Array.from(h.state().audios, item => item.status), ['capturing', 'capturing', 'partial']);
  assert.equal(h.state().audios.reduce((total, item) => total + item.bytes, 0), 200 + AAC.length);
  assert.match(h.state().audios[2].error, /memory limit/);
  await h.request('DOWNLOAD', partialId);
  assert.deepEqual(new Uint8Array(await h.downloads[0].blob.arrayBuffer()), AAC);
  await h.request('CLEAR');
});

test('FULL drains its own response directly without creating an unread clone', async () => {
  const fullResponse = streamResponse([AAC]);
  let cloneCalls = 0;
  fullResponse.clone = () => { cloneCalls++; throw new Error('FULL must not clone'); };
  let calls = 0;
  const h = harness(() => Promise.resolve(++calls === 1 ? controlledResponse().response : fullResponse));
  await h.window.fetch(ENDPOINT);
  await h.until(() => h.state().audios[0]?.status === 'capturing');
  const fullId = (await h.request('FULL', h.state().audios[0].id)).result.id;
  await h.until(() => h.state().audios.find(item => item.id === fullId)?.status === 'ready');
  assert.equal(cloneCalls, 0);
  assert.equal(fullResponse.bodyUsed, true);
  assert.equal(h.downloads.length, 1);
  assert.deepEqual(new Uint8Array(await h.downloads[0].blob.arrayBuffer()), AAC);
});

test('invalid FULL responses abort their independent controller and never save', async t => {
  const fixtures = [
    ['HTTP failure', () => new Response('failure', {status: 503})],
    ['non-audio MIME', () => new Response(AAC, {headers: {'content-type': 'text/html'}})],
    ['absent body', () => new Response(null, {headers: {'content-type': 'audio/aac'}})],
    ['empty audio', () => streamResponse([])],
    ['invalid audio signature', () => streamResponse([Buffer.from('not audio bytes')])]
  ];
  for (const [name, response] of fixtures) await t.test(name, async () => {
    let calls = 0, replay;
    const h = harness(input => {
      if (++calls === 1) return Promise.resolve(controlledResponse().response);
      replay = input;
      return Promise.resolve(response());
    });
    await h.window.fetch(ENDPOINT);
    await h.until(() => h.state().audios[0]?.status === 'capturing');
    const fullId = (await h.request('FULL', h.state().audios[0].id)).result.id;
    await h.until(() => h.state().audios.find(item => item.id === fullId)?.status === 'error');
    assert.equal(replay.signal.aborted, true);
    const item = h.state().audios.find(item => item.id === fullId);
    assert.equal(item.canDownload, false);
    assert.equal(item.canCancel, false);
    assert.equal(h.downloads.length, 0);
  });
});

test('FULL on a ready playback row saves the existing complete recording without a network replay', async () => {
  let calls = 0;
  const h = harness(() => { calls++; return Promise.resolve(streamResponse([AAC])); });
  await h.window.fetch(ENDPOINT);
  await h.until(() => h.state().audios[0]?.status === 'ready');
  const id = h.state().audios[0].id;
  assert.equal(h.downloads.length, 0);
  const result = await h.request('FULL', id);
  assert.equal(result.error, undefined);
  assert.equal(result.result.id, id);
  assert.equal(calls, 1);
  assert.equal(h.state().audios.length, 1);
  assert.equal(h.downloads.length, 1);
  assert.deepEqual(new Uint8Array(await h.downloads[0].blob.arrayBuffer()), AAC);
  assert.doesNotMatch(h.downloads[0].filename, /partial/);
});
