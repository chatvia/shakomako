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

  const embedScriptTag = document.currentScript;

  if (!embedScriptTag) {
    console.error('chatbot: Could not find embed script tag.');
    window[namespace].error = 'Could not find embed script tag.';
    return;
  }

  const agentId = embedScriptTag.getAttribute('agent-id');
  const mountId = embedScriptTag.getAttribute('mount-id');

  window[namespace].agentId = agentId;
  if (mountId) window[namespace].mountId = mountId;

  /* global __SCRIPT_URL__ */
  const scriptHost = __SCRIPT_URL__;
  console.log('chatbot: __SCRIPT_URL__ value is:', scriptHost);

  if (!agentId) {
    console.error('chatbot: Missing agent-id attribute on embed script tag.');
    window[namespace].error = 'Missing agent-id attribute.';
    return;
  }

  console.log(`chatbot: Initializing for agent ${agentId} from ${scriptHost}`);

  // Add init command to the queue
  window[namespace].q = window[namespace].q || [];
  window[namespace].q.push(['init']);

  async function loadBundle() {
    try {
      const versionUrl = `${scriptHost}/version.json?t=${Date.now()}`;
      console.log('chatbot: Fetching version from:', versionUrl);
      
      // Fetch current version from version.json with cache busting
      const versionResponse = await fetch(versionUrl);
      console.log('chatbot: Version response status:', versionResponse.status, versionResponse.statusText);
      
      if (!versionResponse.ok) {
        throw new Error(`Failed to fetch version.json: ${versionResponse.status} ${versionResponse.statusText}`);
      }
      
      const versionData = await versionResponse.json();
      console.log('chatbot: Version data received:', versionData);
      
      const version = versionData.version || '1.0.0';
      console.log('chatbot: Using version:', version);
      
      const scriptId = 'chatbot-embed-script-' + version.replace(/\./g, '-');
      const fullScriptUrl = `${scriptHost}/${version}/widget.min.js`;
      console.log('chatbot: Loading widget from:', fullScriptUrl);

      if (document.getElementById(scriptId)) {
        console.log('chatbot: Bundle script tag already exists for version:', version);
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

      console.log('chatbot: Inserting script tag with ID:', scriptId);
      const firstScript = document.getElementsByTagName('script')[0];

      if (firstScript && firstScript.parentNode) {
        firstScript.parentNode.insertBefore(script, firstScript);
      } else {
        (document.head || document.body).appendChild(script);
      }
    } catch (error) {
      console.error('chatbot: Error loading version or bundle:', error);
      console.error('chatbot: Script host was:', scriptHost);
      window[namespace].error = `Error loading bundle: ${error.message}`;
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
