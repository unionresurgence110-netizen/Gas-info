/* GAS-INFO accessible in-page feedback. Avoids browser-native dialogs that display the hosting origin. */
(() => {
  if (window.gasInfoNotify) return;

  const style = document.createElement('style');
  style.textContent = `
    .gi-toast-region{position:fixed;z-index:2000;top:16px;right:16px;width:min(420px,calc(100vw - 32px));display:grid;gap:10px;pointer-events:none}
    .gi-toast{pointer-events:auto;display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border:1px solid #30363d;border-left:4px solid #58a6ff;border-radius:12px;background:#161b22;color:#e6edf3;box-shadow:0 12px 34px #0005;font:500 14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}
    .gi-toast[data-kind="success"]{border-left-color:#3fb950}.gi-toast[data-kind="error"]{border-left-color:#ff7b72}.gi-toast[data-kind="warning"]{border-left-color:#d29922}
    .gi-toast-message{flex:1}.gi-toast-close{border:0;background:transparent;color:inherit;font-size:20px;line-height:1;cursor:pointer;padding:0 2px}
    .gi-dialog-backdrop{position:fixed;inset:0;z-index:2100;display:flex;align-items:center;justify-content:center;padding:16px;background:#0009}
    .gi-dialog{width:min(480px,100%);max-height:90vh;overflow:auto;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:16px;padding:22px;box-shadow:0 24px 70px #0008;font:400 15px/1.5 system-ui,sans-serif}
    .gi-dialog h2{font-size:1.2rem;margin:0 0 8px}.gi-dialog p{white-space:pre-line;color:#c9d1d9;margin:0 0 16px}.gi-dialog input{box-sizing:border-box;width:100%;margin:0 0 16px;padding:11px;border:1px solid #57606a;border-radius:8px;background:#0d1117;color:#e6edf3;font:inherit}
    .gi-dialog-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}.gi-dialog button{border:1px solid #57606a;border-radius:9px;padding:9px 14px;background:#21262d;color:#e6edf3;font:600 14px system-ui,sans-serif;cursor:pointer}.gi-dialog button.gi-primary{background:#238636;border-color:#238636;color:#fff}.gi-dialog button:focus-visible,.gi-toast button:focus-visible{outline:3px solid #58a6ff;outline-offset:2px}
    body.light .gi-toast,body.light .gi-dialog,body.light-theme .gi-toast,body.light-theme .gi-dialog{background:#fff;color:#24292f;border-color:#d0d7de}body.light .gi-dialog p,body.light-theme .gi-dialog p{color:#57606a}body.light .gi-dialog input,body.light-theme .gi-dialog input{background:#fff;color:#24292f;border-color:#d0d7de}
    @media(max-width:480px){.gi-toast-region{top:10px;right:10px;width:calc(100vw - 20px)}.gi-dialog{padding:18px}.gi-dialog-actions{flex-direction:column-reverse}.gi-dialog-actions button{width:100%}}
  `;
  document.head.appendChild(style);

  let region;
  function getRegion() {
    if (!region) {
      region = document.createElement('div');
      region.className = 'gi-toast-region';
      region.setAttribute('aria-label', 'Notifications');
      document.body.appendChild(region);
    }
    return region;
  }

  function notify(message, kind = 'info', duration = 6000) {
    const toast = document.createElement('div');
    toast.className = 'gi-toast';
    toast.dataset.kind = ['success', 'error', 'warning'].includes(kind) ? kind : 'info';
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const text = document.createElement('div');
    text.className = 'gi-toast-message';
    text.textContent = String(message ?? '');
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'gi-toast-close'; close.setAttribute('aria-label', 'Dismiss message'); close.textContent = '×';
    const remove = () => toast.remove();
    close.addEventListener('click', remove);
    toast.append(text, close);
    getRegion().appendChild(toast);
    if (duration > 0) window.setTimeout(remove, duration);
    return toast;
  }

  function dialog({title = 'GAS-INFO', message = '', confirm = false, prompt = false, inputLabel = 'Your answer', placeholder = '', value = '', confirmText = 'Continue', cancelText = 'Cancel', danger = false} = {}) {
    return new Promise(resolve => {
      const backdrop = document.createElement('div');
      backdrop.className = 'gi-dialog-backdrop';
      const panel = document.createElement('section');
      panel.className = 'gi-dialog'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
      const heading = document.createElement('h2'); heading.textContent = title;
      const body = document.createElement('p'); body.textContent = message;
      panel.append(heading, body);
      let input;
      if (prompt) {
        const label = document.createElement('label'); label.textContent = inputLabel;
        input = document.createElement('input'); input.type = 'text'; input.value = value; input.placeholder = placeholder;
        label.appendChild(input); panel.appendChild(label);
      }
      const actions = document.createElement('div'); actions.className = 'gi-dialog-actions';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = cancelText;
      const accept = document.createElement('button'); accept.type = 'button'; accept.className = 'gi-primary'; accept.textContent = confirmText;
      if (danger) accept.style.background = '#b62324';
      actions.append(cancel, accept); panel.appendChild(actions); backdrop.appendChild(panel); document.body.appendChild(backdrop);
      const finish = result => { document.removeEventListener('keydown', onKey); backdrop.remove(); resolve(result); };
      const onKey = event => { if (event.key === 'Escape') finish(prompt ? null : false); if (event.key === 'Enter' && (prompt || confirm)) { event.preventDefault(); finish(prompt ? input.value : true); } };
      cancel.addEventListener('click', () => finish(prompt ? null : false));
      accept.addEventListener('click', () => finish(prompt ? input.value : true));
      backdrop.addEventListener('click', event => { if (event.target === backdrop) finish(prompt ? null : false); });
      document.addEventListener('keydown', onKey);
      (input || accept).focus();
    });
  }

  window.gasInfoNotify = notify;
  window.gasInfoConfirm = message => dialog({title: 'Please confirm', message, confirm: true});
  window.gasInfoPrompt = (message, options = {}) => dialog({title: options.title || 'GAS-INFO', message, prompt: true, inputLabel: options.label || 'Enter a value', placeholder: options.placeholder || '', value: options.value || '', confirmText: options.confirmText || 'Submit'});
})();
