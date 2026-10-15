import { authHeaders } from './auth';
import { getApiUrl } from './endpoints';

/**
 * Request headers (X-AGENT-ID, X-SESSION-ID, X-CONVERSATION-ID, …). A value
 * that is not known yet, such as the session id before the session starts,
 * may be null; requestHeaders() leaves it out.
 */
export type ApiHeaders = Record<string, string | null | undefined>;

/**
 * Headers ready for fetch(): entries without a value are dropped, so a missing
 * id is an absent header rather than the literal string "null".
 */
export function requestHeaders(headers: ApiHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== null && value !== undefined) result[name] = value;
  }
  return result;
}

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
  /** The file to upload. */
  file: Blob;
  /** Its file name; a File keeps its own name when this is absent. */
  filename?: string;
  /** The form field the file goes in. */
  field?: string;
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
      headers: requestHeaders(mergedHeaders),
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
  filename,
  field = 'file',
  headers = {}
}: UploadRequest): Promise<Response> {
  const mergedHeaders: ApiHeaders = { Accept: 'application/json', ...headers };
  Object.assign(mergedHeaders, authHeaders(mergedHeaders['X-AGENT-ID']));
  // Let fetch derive the multipart boundary.
  delete mergedHeaders['Content-Type'];

  const form = new FormData();
  if (filename) form.append(field, file, filename);
  else form.append(field, file);

  const apiUrl = getApiUrl();

  const response = await fetch(`${apiUrl}/${endpoint}`, {
    method: 'POST',
    headers: requestHeaders(mergedHeaders),
    body: form,
    signal: AbortSignal.timeout ? AbortSignal.timeout(120000) : undefined
  });

  return response;
}
