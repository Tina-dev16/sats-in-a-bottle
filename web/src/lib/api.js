let csrf = '';
export const setCsrf = (t) => { csrf = t || ''; };

export class ApiError extends Error {
  constructor(status, body) { super(body?.error || 'Request failed'); this.status = status; this.field = body?.field; this.code = body?.code; this.body = body; }
}

export async function api(method, path, body) {
  const headers = {};
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
  let res;
  try { res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin' }); }
  catch { throw new ApiError(0, { error: 'Network error' }); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);
