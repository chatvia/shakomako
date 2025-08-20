export default async function api({ endpoint, method, headers = {}, body = null }) {
  const mergedHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...headers
  };

  /* global __API_URL__ */
  const apiUrl = __API_URL__;

  return await fetch(`${apiUrl}/${endpoint}`, {
    method: method,
    headers: mergedHeaders,
    body: body
  });
}
