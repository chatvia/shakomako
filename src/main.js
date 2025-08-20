import { ChatWidget } from './widget.js';

(function () {
  const namespace = 'chatbot';

  if (!window[namespace] || !window[namespace].agentId) {
    console.error(
      'chatbot: Embedder script not found or missing agentId. Cannot initialize widget.'
    );
    return;
  }

  const clientId = window[namespace].agentId;
  const commandQueue = window[namespace].q || [];

  console.log(`chatbot: Instantiating ChatWidget from main.js for client ${clientId}`);

  try {
    const widgetInstance = new ChatWidget(clientId, window[namespace].mountId || null);

    // Replace the proxy function with the actual API handler
    window[namespace] = async function (command, ...args) {
      if (!widgetInstance) {
        console.error(
          'chatbot: Widget instance is not available. Cannot execute command:',
          command
        );
        return;
      }

      switch (command) {
        case 'init':
          await widgetInstance.init();
          break;
        case 'open':
          widgetInstance.toggleChat(true);
          break;
        case 'close':
          widgetInstance.toggleChat(false);
          break;
        case 'sendMessage':
          if (args.length > 0) {
            await widgetInstance.sendUserMessage(args[0]);
          } else {
            console.warn("chatbot: 'sendMessage' called without message text.");
          }
          break;
        default:
          console.warn(`chatbot: Unknown command '${command}'`);
      }
    };

    console.log(`chatbot: Processing ${commandQueue.length} queued commands.`);

    while (commandQueue.length > 0) {
      const commandArgs = commandQueue.shift();

      if (commandArgs) {
        console.log('chatbot: Executing queued command:', commandArgs);
        window[namespace](...commandArgs);
      }
    }

    console.log('chatbot: Chat Widget setup complete.');
  } catch (error) {
    console.error('chatbot: Failed to instantiate or setup ChatWidget:', error);

    window[namespace] = function (command) {
      console.error(
        `chatbot: Widget failed to initialize. Cannot execute command: ${command}`,
        error
      );
    };

    window[namespace].error = 'Widget failed to initialize';
  }
})();
