/* Isolated-world bridge. Audio and request credentials stay in the page closure. */
(() => {
  'use strict';
  const channel = 'chatgpt-audio-downloader:v3';
  const pending = new Map();
  let counter = 0;
  let state = {ready: false, audios: []};
  let panel;
  let dismissedId;
  function request(action, id) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${++counter}`;
      const timer = setTimeout(() => {pending.delete(requestId); reject(new Error('The capture hook did not respond. Reload this ChatGPT tab and try again.'));}, 5000);
      pending.set(requestId, {resolve, reject, timer});
      window.postMessage({channel, type: 'request', requestId, action, id}, location.origin);
    });
  }
  function validState(value) {
    return value && value.version === '3.0.0' && value.ready === true && Array.isArray(value.audios) && value.audios.length <= 20;
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel) return;
    if (event.data.type === 'response') {
      const item = pending.get(event.data.requestId);
      if (!item) return;
      pending.delete(event.data.requestId); clearTimeout(item.timer);
      if (event.data.error) item.reject(new Error(String(event.data.error)));
      else item.resolve(event.data.result);
    } else if (event.data.type === 'update' && validState(event.data.state)) {
      state = event.data.state; render();
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!['STATE', 'DOWNLOAD', 'FULL', 'CANCEL', 'CLEAR'].includes(message?.action)) return false;
    request(message.action, message.id).then(result => {
      if (message.action === 'STATE' && validState(result)) {state = result; render();}
      sendResponse({ok: true, result});
    }, error => sendResponse({ok: false, error: error.message}));
    return true;
  });
  const size = n => n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  function setup() {
    const host = document.createElement('div');
    host.id = 'chatgpt-audio-downloader';
    // A shadow root isolates the panel from ChatGPT CSS and prevents broad selectors changing it.
    const shadow = host.attachShadow({mode: 'open'});
    const style = document.createElement('style');
    style.textContent = `:host{all:initial;position:fixed;right:20px;bottom:100px;z-index:2147483646;color-scheme:light dark}section{width:310px;box-sizing:border-box;font:13px/1.5 system-ui,sans-serif;background:#181b23;color:#f6f7fb;padding:16px;border:1px solid #4c5567;border-radius:12px;box-shadow:0 6px 24px #0005}header{display:flex;justify-content:space-between;align-items:center;font-weight:650;font-size:14px}p{margin:8px 0}small{display:block;color:#bdc6d6}.actions{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;cursor:pointer;border:1px solid #66738a;border-radius:6px;background:#253042;color:#fff;padding:7px 10px}button.primary{background:#0f6654;border-color:#2fa98e}button:focus-visible{outline:3px solid #92cdfb;outline-offset:3px}button:disabled{opacity:.5;cursor:wait}button.close{padding:0 6px;font-size:18px;background:transparent;border:0}[hidden]{display:none!important}`;
    shadow.append(style);
    const section = document.createElement('section');
    section.setAttribute('aria-label', 'ChatGPT audio download');
    const header = document.createElement('header');
    const title = document.createElement('span'); title.textContent = 'ChatGPT Audio Downloader';
    const close = document.createElement('button'); close.className = 'close'; close.textContent = '×'; close.setAttribute('aria-label','Dismiss audio panel');
    close.onclick = () => {dismissedId = state.audios.at(-1)?.id; section.hidden = true;};
    header.append(title, close);
    const status = document.createElement('p');
    const detail = document.createElement('small');
    const message = document.createElement('p'); message.setAttribute('role', 'status');
    const actions = document.createElement('div'); actions.className = 'actions';
    section.append(header, status, detail, message, actions); section.hidden = true;
    shadow.append(section); document.documentElement.append(host);
    panel = {section, status, detail, message, actions};
    render();
    request('STATE').then(result => {if (validState(result)) {state = result; render();}}).catch(() => {});
  }
  function render() {
    if (!panel) return;
    const item = state.audios.at(-1);
    if (!item || dismissedId === item.id) {panel.section.hidden = true; return;}
    panel.section.hidden = false;
    const labels = {waiting:'Waiting for ChatGPT audio…',capturing:'Receiving audio…',ready:'Complete audio ready',partial:'Partial audio available',error:'Audio capture failed'};
    panel.status.textContent = `${labels[item.status] || 'Audio capture'} · ${size(item.bytes)}`;
    panel.detail.textContent = item.status === 'ready' ? 'The full response has arrived. You can save it now.'
      : item.source === 'full' ? 'Playback can stop. This fetch continues independently.'
      : 'Download full audio can continue even if you stop playback.';
    if (panel.message.dataset.item !== item.id || panel.message.dataset.status !== item.status) {
      panel.message.textContent = item.error || '';
      panel.message.dataset.item = item.id; panel.message.dataset.status = item.status;
    }
    // Preserve focused buttons while progress updates arrive.
    const signature = [item.id, item.status, item.canDownload, item.canFetchFull, item.canCancel].join(':');
    if (panel.actions.dataset.signature === signature) return;
    const focusedCommand = panel.actions.getRootNode().activeElement?.dataset.command;
    panel.actions.dataset.signature = signature; panel.actions.replaceChildren();
    function action(label, command, primary = false) {
      const button = document.createElement('button'); button.dataset.command = command; button.textContent = label; if (primary) button.className = 'primary';
      button.onclick = async () => {
        button.disabled = true;
        try {const result = await request(command, item.id); panel.message.textContent = result.message;}
        catch (error) {panel.message.textContent = error.message;}
        finally {button.disabled = false;}
      };
      panel.actions.append(button);
    }
    if (item.status === 'ready') action('Save audio', 'DOWNLOAD', true);
    else {
      if (item.canFetchFull) action(item.source === 'full' ? 'Retry full download' : 'Download full audio', 'FULL', true);
      if (item.canDownload) action('Save partial', 'DOWNLOAD');
    }
    if (item.canCancel) action('Cancel full fetch', 'CANCEL');
    if (focusedCommand) {
      const buttons = [...panel.actions.querySelectorAll('button')];
      (buttons.find(button => button.dataset.command === focusedCommand) || buttons[0])?.focus();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, {once:true});
  else setup();
})();
