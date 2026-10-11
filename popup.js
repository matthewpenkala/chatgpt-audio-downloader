(() => {
  'use strict';
  const list = document.getElementById('audio-list');
  const status = document.getElementById('status');
  const clear = document.getElementById('clear');
  let tabId;
  let busy = false;
  let closed = false;
  let signature = '';
  let timer;
  const size = n => n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  function send(action, id) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, {action, id}, response => {
        if (chrome.runtime.lastError) {reject(new Error('Reload this ChatGPT tab once to activate the extension.')); return;}
        if (!response?.ok) {reject(new Error(response?.error || 'The extension did not respond. Reload the ChatGPT tab.')); return;}
        resolve(response.result);
      });
    });
  }
  async function refresh(manual = false) {
    if (busy || closed || !tabId) return;
    busy = true;
    try {
      const state = await send('STATE');
      if (!state?.ready || state.version !== '3.0.0' || !Array.isArray(state.audios)) throw new Error('Reload this ChatGPT tab to activate version 3.');
      render(state.audios);
      if (manual || !status.dataset.action) status.textContent = state.audios.length ? 'Connected · recordings from this tab' : 'Connected · start Read Aloud on a response.';
      status.dataset.connected = 'true';
    } catch (error) {status.textContent = error.message; status.dataset.connected = 'false';}
    finally {busy = false; if (!closed) timer = setTimeout(() => refresh(), 1000);}
  }
  function render(audios) {
    clear.hidden = audios.length === 0;
    const nextSignature = JSON.stringify(audios.map(item => [item.id, item.status, item.canDownload, item.canFetchFull, item.canCancel]));
    if (signature !== nextSignature) {
      const focused = document.activeElement;
      const focusId = focused?.closest('article')?.dataset.id;
      const focusCommand = focused?.dataset.command;
      signature = nextSignature; list.replaceChildren();
      if (!audios.length) {
        const empty = document.createElement('p'); empty.textContent = 'No audio captured yet. Use Read Aloud in this ChatGPT tab, then reopen this popup.'; list.append(empty);
      }
      for (const item of [...audios].reverse()) {
        const article = document.createElement('article'); article.dataset.id = item.id;
        const title = document.createElement('h2');
        const meta = document.createElement('p'); meta.className = 'meta';
        const error = document.createElement('p'); error.className = 'error';
        const actions = document.createElement('div'); actions.className = 'actions';
        article.append(title, meta, error, actions); list.append(article);
        if (item.status === 'ready') action(actions, 'Save audio', 'DOWNLOAD', item.id, true);
        else {
          if (item.canFetchFull) action(actions, item.source === 'full' ? 'Retry full download' : 'Download full audio', 'FULL', item.id, true);
          if (item.canDownload) action(actions, 'Save partial', 'DOWNLOAD', item.id);
        }
        if (item.canCancel) action(actions, 'Cancel full fetch', 'CANCEL', item.id);
      }
      if (focusId) {
        const row = [...list.querySelectorAll('article')].find(node => node.dataset.id === focusId);
        const button = row && [...row.querySelectorAll('button')].find(node => node.dataset.command === focusCommand);
        if (button) button.focus();
        else if (row) {row.tabIndex = -1; row.focus();}
        else document.getElementById('refresh').focus();
      }
    }
    for (const article of list.querySelectorAll('article')) {
      const item = audios.find(audio => audio.id === article.dataset.id);
      const labels = {waiting:'Waiting for audio',capturing:'Receiving audio',ready:'Complete audio',partial:'Partial audio',error:'Capture failed'};
      article.querySelector('h2').textContent = `${labels[item.status] || 'Recording'}${item.source === 'full' ? ' · full fetch' : ''}`;
      article.querySelector('.meta').textContent = `${new Date(item.createdAt).toLocaleTimeString('en-US')} · ${size(item.bytes)} · ${(item.elapsedMs / 1000).toFixed(1)}s${item.extension ? ` · ${item.extension.toUpperCase()}` : ''}`;
      const error = article.querySelector('.error'); error.textContent = item.error || ''; error.hidden = !item.error;
    }
  }
  function action(parent, label, command, id, primary = false) {
    const button = document.createElement('button'); button.dataset.command = command; button.textContent = label; if (primary) button.className = 'primary';
    button.onclick = async () => {
      button.disabled = true; status.dataset.action = 'true';
      try {const result = await send(command, id); status.textContent = result.message; clearTimeout(timer); await refresh();}
      catch (error) {status.textContent = error.message;}
      finally {button.disabled = false;}
    };
    parent.append(button);
  }
  document.getElementById('refresh').onclick = () => {clearTimeout(timer); delete status.dataset.action; refresh(true);};
  clear.onclick = async () => {
    clear.disabled = true; status.dataset.action = 'true';
    try {const result = await send('CLEAR'); status.textContent = result.message; clearTimeout(timer); await refresh();}
    catch (error) {status.textContent = error.message;}
    finally {clear.disabled = false;}
  };
  window.addEventListener('pagehide', () => {closed = true; clearTimeout(timer);});
  chrome.tabs.query({active:true, currentWindow:true}, tabs => {
    const tab = tabs?.[0];
    let supported = false;
    try {supported = new URL(tab?.url).origin === 'https://chatgpt.com';} catch {}
    if (!supported) {status.textContent = 'Open a ChatGPT tab to use this extension.'; return;}
    tabId = tab.id; refresh();
  });
})();
