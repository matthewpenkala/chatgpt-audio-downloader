/* Pure helpers shared by the page hook and regression tests. */
(() => {
  'use strict';
  const formats = Object.freeze({
    'audio/aac': 'aac', 'audio/aacp': 'aac', 'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'application/ogg': 'ogg',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/webm': 'webm'
  });
  function audioRequest(input, base) {
    try {
      const url = new URL(typeof input === 'string' ? input : input?.url || String(input), base);
      return url.origin === 'https://chatgpt.com' && /^\/backend-api\/synthesize\/?$/.test(url.pathname) ? url : null;
    } catch { return null; }
  }
  function sniff(bytes) {
    const text = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
    if (bytes.length >= 7 && bytes[0] === 255 && (bytes[1] & 246) === 240) return 'aac';
    if (text(0, 3) === 'ID3' || (bytes.length >= 4 && bytes[0] === 255 && (bytes[1] & 224) === 224 && (bytes[1] & 6) !== 0)) return 'mp3';
    if (text(0, 4) === 'OggS') return 'ogg';
    if (text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE') return 'wav';
    if (text(4, 4) === 'ftyp') return 'm4a';
    if ([26, 69, 223, 163].every((v, i) => bytes[i] === v)) return 'webm';
    return null;
  }
  function formatFor(mime, bytes) {
    const type = String(mime || '').split(';')[0].trim().toLowerCase();
    const detected = sniff(bytes);
    if (detected && (formats[type] || type === 'application/octet-stream' || !type)) return detected;
    return null;
  }
  function filename(createdAt, id, extension, partial = false) {
    return `ChatGPT_Audio_${new Date(createdAt).toISOString().replace(/[:.]/g, '-')}_${id.slice(-8)}${partial ? '-partial' : ''}.${extension}`;
  }
  const core = Object.freeze({audioRequest, sniff, formatFor, filename});
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else Object.defineProperty(globalThis, 'ChatGPTAudioCore', {value: core, configurable: true});
})();
