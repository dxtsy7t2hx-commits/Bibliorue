// Client de l'API Bibliorue (même origine ; le cookie de session est envoyé automatiquement).
export class ApiError extends Error {
  constructor(status, data) { super(data?.error ?? `Erreur ${status}`); this.status = status; this.data = data; }
}

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  me: () => call('GET', '/api/me'),
  register: (d) => call('POST', '/api/auth/register', d),
  login: (d) => call('POST', '/api/auth/login', d),
  logout: () => call('POST', '/api/auth/logout', {}),
  updateMe: (d) => call('PATCH', '/api/me', d),
  deleteMe: (password) => call('DELETE', '/api/me', { password }),

  boxes: (bbox) => call('GET', '/api/boxes?' + new URLSearchParams(bbox ?? {})),
  box: (id) => call('GET', `/api/boxes/${id}`),
  addBox: (d) => call('POST', '/api/boxes', d),
  updateBox: (id, d) => call('PATCH', `/api/boxes/${id}`, d),
  deleteBox: (id) => call('DELETE', `/api/boxes/${id}`, {}),

  addBook: (boxId, d) => call('POST', `/api/boxes/${boxId}/books`, d),
  takeBook: (id) => call('POST', `/api/books/${id}/take`, {}),
  returnBook: (id, boxId) => call('POST', `/api/books/${id}/return`, { boxId }),
  goneBook: (id) => call('POST', `/api/books/${id}/gone`, {}),

  search: (q) => call('GET', '/api/search?' + new URLSearchParams({ q })),
  activity: () => call('GET', '/api/activity'),
  report: (targetType, targetId, reason) => call('POST', '/api/reports', { targetType, targetId, reason }),
  reports: () => call('GET', '/api/admin/reports'),
  resolveReport: (id) => call('POST', `/api/admin/reports/${id}/resolve`, {}),
};
