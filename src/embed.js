window.chatvia =
  window.chatvia ||
  function () {
    (window.chatvia.q = window.chatvia.q || []).push(arguments);
  };

(function () {
  const namespace = 'chatvia';

  // Prevent multiple initializations (check within the IIFE)
  if (window[namespace].initialized) {
    console.warn('chatvia already initialized.');
    return;
  }

  window[namespace].initialized = true;

  // Safari-compatible script tag detection
  // document.currentScript doesn't work in Safari with async scripts
  let embedScriptTag = document.currentScript;

  // Fallback for Safari and other browsers where currentScript is null
  if (!embedScriptTag) {
    // Try to find by ID first (recommended approach)
    embedScriptTag = document.getElementById('chatbot-embed-script');

    // If not found by ID, search for script with agent-id attribute
    if (!embedScriptTag) {
      const scripts = document.querySelectorAll('script[agent-id]');
      embedScriptTag = scripts[scripts.length - 1]; // Get the last one (most recently added)
    }
  }

  if (!embedScriptTag) {
    console.error('chatvia: Could not find embed script tag. Make sure the script has id="chatbot-embed-script" or agent-id attribute.');
    window[namespace].error = 'Could not find embed script tag.';
    return;
  }

  const agentId = embedScriptTag.getAttribute('agent-id');
  const mountId = embedScriptTag.getAttribute('mount-id');
  const type = embedScriptTag.getAttribute('type') || 'widget'; // 'widget' or 'search'
  const language = embedScriptTag.getAttribute('data-language') || 'auto';

  window[namespace].agentId = agentId;
  window[namespace].type = type;
  window[namespace].language = language;
  if (mountId) window[namespace].mountId = mountId;

  /* global __SCRIPT_URL__ */
  // Determine script host: use __SCRIPT_URL__ if set, otherwise detect from script src
  let scriptHost = __SCRIPT_URL__;


  if (!agentId) {
    console.error('chatvia: Missing agent-id attribute on embed script tag.');
    window[namespace].error = 'Missing agent-id attribute.';
    return;
  }

  console.log(`chatvia: Initializing for agent ${agentId} from ${scriptHost}`);

  // Add init command to the queue
  window[namespace].q = window[namespace].q || [];
  window[namespace].q.push(['init']);

  async function loadBundle() {
    try {
      const versionUrl = `${scriptHost}/version.json?t=${Date.now()}`;
      console.log('chatvia: Fetching version from:', versionUrl);

      // Fetch current version from version.json with cache busting
      const versionResponse = await fetch(versionUrl);
      console.log('chatvia: Version response status:', versionResponse.status, versionResponse.statusText);

      if (!versionResponse.ok) {
        throw new Error(`Failed to fetch version.json: ${versionResponse.status} ${versionResponse.statusText}`);
      }

      const versionData = await versionResponse.json();
      console.log('chatvia: Version data received:', versionData);

      const version = versionData.version;
      console.log('chatvia: Using version:', version);

      const bundleFile = type === 'search' ? 'search.min.js' : 'widget.min.js';
      const scriptId = 'chatvia-embed-script-' + type + '-' + version.replace(/\./g, '-');
      const fullScriptUrl = `${scriptHost}/${version}/${bundleFile}`;
      console.log(`chatvia: Loading ${type} from:`, fullScriptUrl);

      if (document.getElementById(scriptId)) {
        console.log('chatvia: Bundle script tag already exists for version:', version);
        return;
      }

      const script = document.createElement('script');

      script.id = scriptId;
      script.type = 'text/javascript';
      script.defer = true;
      script.src = fullScriptUrl;
      script.onerror = () => {
        console.error(`chatvia: Failed to load bundle from ${fullScriptUrl}`);
        window[namespace].error = `Failed to load bundle from ${fullScriptUrl}`;
      };
      script.onload = () =>
        console.log(`chatvia: Bundle loaded successfully from ${fullScriptUrl}`);

      console.log('chatvia: Inserting script tag with ID:', scriptId);
      const firstScript = document.getElementsByTagName('script')[0];

      if (firstScript && firstScript.parentNode) {
        firstScript.parentNode.insertBefore(script, firstScript);
      } else {
        (document.head || document.body).appendChild(script);
      }
    } catch (error) {
      console.error('chatvia: Error loading version or bundle:', error);
      console.error('chatvia: Script host was:', scriptHost);
      window[namespace].error = `Error loading bundle: ${error.message}`;
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadBundle);
    console.log('chatvia: DOMContentLoaded listener added.');
  } else {
    console.log('chatvia: DOM already loaded or script deferred, loading bundle immediately.');
    loadBundle();
  }
})();
