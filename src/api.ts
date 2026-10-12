import { authHeaders } from './auth';
import { getApiUrl } from './endpoints';

/**
 * Request headers (X-AGENT-ID, X-SESSION-ID, X-CONVERSATION-ID, …). A value
 * that is not known yet, such as the session id before the session starts, is
 * sent as fetch stringifies it.
 */
export type ApiHeaders = Record<string, string | null | undefined>;

export interface ApiRequest {
  /** API endpoint, relative to the widget API base URL. */
  endpoint: string;
  /** HTTP method. */
  method: string;
  /** Additional headers. */
  headers?: ApiHeaders;
  /** Request body (JSON string). */
  body?: string | null;
}

export interface UploadRequest {
  /** e.g. 'conversations/attachments' */
  endpoint: string;
  /** The File object to upload. */
  file: File;
  /** X-AGENT-ID, X-SESSION-ID, X-CONVERSATION-ID, etc. */
  headers?: ApiHeaders;
}

/**
 * Make an API request with proper error handling
 * @returns Fetch response
 */
export default async function api({
  endpoint,
  method,
  headers = {},
  body = null
}: ApiRequest): Promise<Response> {
  const mergedHeaders: ApiHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...headers
  };

  // Attach the widget session token (X-AUTH-TOKEN) for protected agents. Keyed
  // off the X-AGENT-ID the caller already sets, so every gated api() call is
  // authorized without each call site knowing about auth.
  Object.assign(mergedHeaders, authHeaders(mergedHeaders['X-AGENT-ID']));

  const apiUrl = getApiUrl();

  try {
    const response = await fetch(`${apiUrl}/${endpoint}`, {
      method: method,
      headers: mergedHeaders as HeadersInit,
      body: body,
      // Add timeout via AbortController for better error handling
      signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined
    });

    return response;
  } catch (error) {
    // Re-throw with more context
    const { name } = error as Error;
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new Error(`API request timeout: ${endpoint}`, { cause: error });
    }
    throw error;
  }
}

/**
 * Multipart file upload — separate from api() because Content-Type must be
 * unset so the browser fills in the boundary, and we need a longer timeout
 * than the JSON RPC default.
 */
export async function uploadFile({
  endpoint,
  file,
  headers = {}
}: UploadRequest): Promise<Response> {
  const mergedHeaders: ApiHeaders = { Accept: 'application/json', ...headers };
  Object.assign(mergedHeaders, authHeaders(mergedHeaders['X-AGENT-ID']));
  // Let fetch derive the multipart boundary.
  delete mergedHeaders['Content-Type'];

  const form = new FormData();
  form.append('file', file);

  const apiUrl = getApiUrl();

  const response = await fetch(`${apiUrl}/${endpoint}`, {
    method: 'POST',
    headers: mergedHeaders as HeadersInit,
    body: form,
    signal: AbortSignal.timeout ? AbortSignal.timeout(120000) : undefined
  });

  return response;
}
