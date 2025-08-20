# Chat Widget Project

A customizable, embeddable chat widget with Markdown support, designed to connect via Server-Sent Events (SSE).

## Features

*   **Embeddable:** Easily integrate the chat widget into any web page.
*   **Customizable:** Adapt the look and feel (though details on customization need implementation/documentation).
*   **Markdown Support:** Renders messages formatted with Markdown.
*   **SSE Communication:** Connects to an SSE backend for real-time messaging.
*   **Streaming Responses:** Simulates streaming responses from the backend.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

*   [Node.js](https://nodejs.org/) (LTS version recommended)
*   [npm](https://www.npmjs.com/) (comes with Node.js)

### Installation

```bash
npm install
npm run dev
```

### Configuration

The project uses environment variables for configuration, managed via `.env` files.

1.  **Create a `.env` file:** Copy the example file:
    ```bash
    cp .env.example .env
    ```
2.  **Edit `.env`:** Update the variables as needed. For local development, you'll likely need to configure the SSE server URL. If you run the included simulation server (`server.js`), the default URL might be `http://localhost:8080/events`.
    ```dotenv
    # Example .env content
    SSE_URL=http://localhost:8080/events
    # Add other configuration variables here if needed
    ```

## Running Locally

To run the project locally, you'll typically need to run both the frontend development server and the backend simulation server.

1.  **Start the Backend Simulation Server:**
    This server simulates responses for the chat widget.
    ```bash
    node server.js
    ```
    This will start the SSE server, usually on port 8080 (or the port specified by the `PORT` environment variable).

2.  **Start the Frontend Development Server:**
    This command uses Vite to serve the frontend with hot module replacement.
    ```bash
    npm run dev
    ```
    Vite will output the URL where you can access the development version (likely `http://localhost:5173` or similar, check the console output). Open `dev.html` or `index.html` in your browser through this URL.

## Building for Production

To create optimized static assets for deployment:

```bash
npm run build
```
