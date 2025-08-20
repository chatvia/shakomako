window.chatbot =
  window.chatbot ||
  function () {
    (window.chatbot.q = window.chatbot.q || []).push(arguments);
  };

(function () {
  const namespace = 'chatbot';

  // Prevent multiple initializations (check within the IIFE)
  if (window[namespace].initialized) {
    console.warn('chatbot already initialized.');
    return;
  }

  window[namespace].initialized = true;

  /* global __APP_VERSION__ */
  const v = __APP_VERSION__ || '1.0.0';

  const scriptId = 'chatbot-embed-script-' + v.replace(/\./g, '-');
  const embedScriptTag = document.currentScript || document.getElementById(scriptId);

  if (!embedScriptTag) {
    console.error('chatbot: Could not find embed script tag.');
    window[namespace].error = 'Could not find embed script tag.';
    return;
  }

  const agentId = embedScriptTag.getAttribute('agent-id');
  const mountId = embedScriptTag.getAttribute('data-mount-id');

  window[namespace].agentId = agentId;
  if (mountId) window[namespace].mountId = mountId;

  /* global __SCRIPT_URL__ */
  const scriptHost = __SCRIPT_URL__;
  const fullScriptUrl = `${scriptHost}/${v}/widget.min.js`;

  if (!agentId) {
    console.error('chatbot: Missing agent-id attribute on embed script tag.');
    window[namespace].error = 'Missing agent-id attribute.';
    return;
  }

  console.log(`chatbot: Initializing for agent ${agentId} from ${scriptHost}`);

  // Add init command to the queue
  window[namespace].q = window[namespace].q || [];
  window[namespace].q.push(['init']);

  function loadBundle() {
    if (document.getElementById(scriptId)) {
      console.log('chatbot: Bundle script tag already exists.');
      return;
    }

    const script = document.createElement('script');

    script.id = scriptId;
    script.type = 'text/javascript';
    script.defer = true;
    script.src = fullScriptUrl;
    script.onerror = () => {
      console.error(`chatbot: Failed to load chatbot bundle from ${fullScriptUrl}`);
      window[namespace].error = `Failed to load bundle from ${fullScriptUrl}`;
    };
    script.onload = () =>
      console.log(`chatbot: chatbot bundle loaded successfully from ${fullScriptUrl}`);

    const firstScript = document.getElementsByTagName('script')[0];

    if (firstScript && firstScript.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      (document.head || document.body).appendChild(script);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadBundle);
    console.log('chatbot: DOMContentLoaded listener added.');
  } else {
    console.log('chatbot: DOM already loaded or script deferred, loading bundle immediately.');
    loadBundle();
  }
})();
