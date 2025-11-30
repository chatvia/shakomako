import { ChatWidget } from './widget.js';

(function () {
  const namespace = 'chatvia';

  if (!window[namespace] || !window[namespace].agentId) {
    console.error(
      'chatvia: Embedder script not found or missing agentId. Cannot initialize widget.'
    );
    return;
  }

  const clientId = window[namespace].agentId;
  const commandQueue = window[namespace].q || [];
  const eventListeners = {};

  console.log(`chatvia: Instantiating ChatWidget from main.js for client ${clientId}`);

  try {
    const widgetInstance = new ChatWidget(clientId, window[namespace].mountId);

    // Create the public API object
    const api = {
      // Properties
      agentId: clientId,
      
      /**
       * Initialize the widget
       * @returns {Promise<void>}
       */
      init: async () => {
        await widgetInstance.init();
      },

      /**
       * Open the chat window
       */
      open: () => {
        widgetInstance.toggleChat(true);
      },

      /**
       * Close the chat window
       */
      close: () => {
        widgetInstance.toggleChat(false);
      },

      /**
       * Toggle the chat window open/closed
       * @returns {boolean} - New state (true = open, false = closed)
       */
      toggle: () => {
        widgetInstance.toggleChat();
        return widgetInstance.isOpen;
      },

      /**
       * Check if the chat window is open
       * @returns {boolean}
       */
      isOpen: () => {
        return widgetInstance.isOpen;
      },

      /**
       * Send a message programmatically
       * @param {string} message - The message text to send
       * @returns {Promise<void>}
       */
      send: async (message) => {
        if (!message || typeof message !== 'string') {
          console.warn("chatvia: 'send' called without valid message text.");
          return;
        }
        await widgetInstance.sendUserMessage(message.trim());
      },

      /**
       * Alias for send() - backward compatibility
       * @param {string} message - The message text to send
       * @returns {Promise<void>}
       */
      sendMessage: async (message) => {
        await api.send(message);
      },

      /**
       * Start a new chat thread
       * @returns {Promise<void>}
       */
      newChat: async () => {
        await widgetInstance.startNewThread();
      },

      /**
       * Destroy the widget and clean up resources
       */
      destroy: () => {
        widgetInstance.destroy();
      },

      /**
       * Subscribe to widget events
       * @param {string} event - Event name ('open', 'close', 'message', 'ready')
       * @param {Function} callback - Callback function
       * @returns {Function} - Unsubscribe function
       */
      on: (event, callback) => {
        if (typeof callback !== 'function') {
          console.warn(`chatvia: 'on' requires a function callback`);
          return () => {};
        }
        
        if (!eventListeners[event]) {
          eventListeners[event] = [];
        }
        eventListeners[event].push(callback);
        
        // Return unsubscribe function
        return () => {
          const idx = eventListeners[event].indexOf(callback);
          if (idx > -1) eventListeners[event].splice(idx, 1);
        };
      },

      /**
       * Unsubscribe from widget events
       * @param {string} event - Event name
       * @param {Function} callback - Callback to remove (optional, removes all if not provided)
       */
      off: (event, callback) => {
        if (!eventListeners[event]) return;
        if (callback) {
          const idx = eventListeners[event].indexOf(callback);
          if (idx > -1) eventListeners[event].splice(idx, 1);
        } else {
          eventListeners[event] = [];
        }
      },

      // Legacy function-style API for backward compatibility
      __call: async (command, ...args) => {
        switch (command) {
          case 'init': return api.init();
          case 'open': return api.open();
          case 'close': return api.close();
          case 'toggle': return api.toggle();
          case 'send':
          case 'sendMessage': return api.send(args[0]);
          case 'newChat': return api.newChat();
          case 'destroy': return api.destroy();
          default:
            console.warn(`chatvia: Unknown command '${command}'`);
        }
      }
    };

    // Set up DOM event listeners to emit custom events
    document.addEventListener('chat:opened', () => {
      (eventListeners['open'] || []).forEach(cb => cb());
    });
    
    document.addEventListener('chat:closed', () => {
      (eventListeners['close'] || []).forEach(cb => cb());
    });

    // Make API callable as function for legacy support: chatbot('open')
    const proxyHandler = {
      apply: (target, thisArg, args) => target.__call(...args),
      get: (target, prop) => target[prop]
    };
    
    window[namespace] = new Proxy(api, proxyHandler);

    // Process queued commands
    console.log(`chatvia: Processing ${commandQueue.length} queued commands.`);

    while (commandQueue.length > 0) {
      const commandArgs = commandQueue.shift();
      if (commandArgs) {
        console.log('chatvia: Executing queued command:', commandArgs);
        api.__call(...commandArgs);
      }
    }

    // Emit ready event
    setTimeout(() => {
      (eventListeners['ready'] || []).forEach(cb => cb());
    }, 0);

    console.log('chatvia: Chat Widget setup complete.');
  } catch (error) {
    console.error('chatvia: Failed to instantiate or setup ChatWidget:', error);

    window[namespace] = function (command) {
      console.error(
        `chatvia: Widget failed to initialize. Cannot execute command: ${command}`,
        error
      );
    };

    window[namespace].error = 'Widget failed to initialize';
  }
})();
