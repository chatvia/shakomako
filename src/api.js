/**
 * Make an API request with proper error handling
 * @param {Object} options - Request options
 * @param {string} options.endpoint - API endpoint
 * @param {string} options.method - HTTP method
 * @param {Object} options.headers - Additional headers
 * @param {string|null} options.body - Request body (JSON string)
 * @returns {Promise<Response>} - Fetch response
 */
export default async function api({ endpoint, method, headers = {}, body = null }) {
  const mergedHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...headers
  };

  /* global __API_URL__ */
  const apiUrl = __API_URL__;

  try {
    const response = await fetch(`${apiUrl}/${endpoint}`, {
      method: method,
      headers: mergedHeaders,
      body: body,
      // Add timeout via AbortController for better error handling
      signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined
    });
    
    return response;
  } catch (error) {
    // Re-throw with more context
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new Error(`API request timeout: ${endpoint}`);
    }
    throw error;
  }
}
