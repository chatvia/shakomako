// Versioned embed script - This loads the actual widget/search bundle
(function () {
  const namespace = 'chatvia';

  // Prevent multiple initializations
  if (window[namespace].initialized) {
    console.warn('chatvia embed already initialized.');
    return;
  }

  window[namespace].initialized = true;

  // Get configuration from window.chatvia (set by loader.js)
  const agentId = window[namespace].agentId;
  const type = window[namespace].type || 'widget';
  const language = window[namespace].language || 'auto';

  /* global __SCRIPT_URL__ */
  const scriptHost = __SCRIPT_URL__;

  if (!agentId) {
    console.error('chatvia: Missing agent-id. Loader did not set it correctly.');
    window[namespace].error = 'Missing agent-id.';
    return;
  }

  console.log(`chatvia: Initializing ${type} for agent ${agentId} from ${scriptHost}`);

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
