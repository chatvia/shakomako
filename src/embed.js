// Minimal loader script - This file should rarely change
// It loads the versioned embed.js to avoid caching issues
window.chatvia =
  window.chatvia ||
  function () {
    (window.chatvia.q = window.chatvia.q || []).push(arguments);
  };

(function () {
  const namespace = 'chatvia';

  // Prevent multiple initializations
  if (window[namespace].loaderInitialized) {
    console.warn('chatvia loader already initialized.');
    return;
  }

  window[namespace].loaderInitialized = true;

  // Safari-compatible script tag detection
  let loaderScriptTag = document.currentScript;

  // Fallback for Safari and other browsers where currentScript is null
  if (!loaderScriptTag) {
    loaderScriptTag = document.getElementById('chatbot-embed-script');

    if (!loaderScriptTag) {
      const scripts = document.querySelectorAll('script[agent-id]');
      loaderScriptTag = scripts[scripts.length - 1];
    }
  }

  if (!loaderScriptTag) {
    console.error('chatvia: Could not find loader script tag. Make sure the script has id="chatbot-embed-script" or agent-id attribute.');
    window[namespace].error = 'Could not find loader script tag.';
    return;
  }

  // Store attributes for the embed script to use later
  const agentId = loaderScriptTag.getAttribute('agent-id');
  const mountId = loaderScriptTag.getAttribute('mount-id');
  const type = loaderScriptTag.getAttribute('type') || 'widget';
  const language = loaderScriptTag.getAttribute('data-language') || 'auto';

  window[namespace].agentId = agentId;
  window[namespace].type = type;
  window[namespace].language = language;
  if (mountId) window[namespace].mountId = mountId;

  /* global __SCRIPT_URL__ */
  const scriptHost = __SCRIPT_URL__;

  if (!agentId) {
    console.error('chatvia: Missing agent-id attribute on loader script tag.');
    window[namespace].error = 'Missing agent-id attribute.';
    return;
  }

  console.log(`chatvia: Loading for agent ${agentId} from ${scriptHost}`);

  async function loadEmbedScript() {
    try {
      const versionUrl = `${scriptHost}/version.json?t=${Date.now()}`;
      console.log('chatvia: Fetching version from:', versionUrl);

      const versionResponse = await fetch(versionUrl);
      console.log('chatvia: Version response status:', versionResponse.status, versionResponse.statusText);

      if (!versionResponse.ok) {
        throw new Error(`Failed to fetch version.json: ${versionResponse.status} ${versionResponse.statusText}`);
      }

      const versionData = await versionResponse.json();
      console.log('chatvia: Version data received:', versionData);

      const version = versionData.version;
      console.log('chatvia: Using version:', version);

      const scriptId = 'chatvia-bootstrap-script-' + version.replace(/\./g, '-');
      const fullScriptUrl = `${scriptHost}/${version}/bootstrap.js`;
      console.log('chatvia: Loading bootstrap script from:', fullScriptUrl);

      if (document.getElementById(scriptId)) {
        console.log('chatvia: Bootstrap script already exists for version:', version);
        return;
      }

      const script = document.createElement('script');
      script.id = scriptId;
      script.type = 'text/javascript';
      script.defer = true;
      script.src = fullScriptUrl;
      script.onerror = () => {
        console.error(`chatvia: Failed to load bootstrap script from ${fullScriptUrl}`);
        window[namespace].error = `Failed to load bootstrap script from ${fullScriptUrl}`;
      };
      script.onload = () =>
        console.log(`chatvia: Bootstrap script loaded successfully from ${fullScriptUrl}`);

      console.log('chatvia: Inserting bootstrap script tag with ID:', scriptId);
      const firstScript = document.getElementsByTagName('script')[0];

      if (firstScript && firstScript.parentNode) {
        firstScript.parentNode.insertBefore(script, firstScript);
      } else {
        (document.head || document.body).appendChild(script);
      }
    } catch (error) {
      console.error('chatvia: Error loading version or bootstrap script:', error);
      console.error('chatvia: Script host was:', scriptHost);
      window[namespace].error = `Error loading bootstrap script: ${error.message}`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadEmbedScript);
    console.log('chatvia: DOMContentLoaded listener added.');
  } else {
    console.log('chatvia: DOM already loaded, loading bootstrap script immediately.');
    loadEmbedScript();
  }
})();

