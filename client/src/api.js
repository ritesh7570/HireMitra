export async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(data?.error || 'Request failed');
  }
  return data;
}

export const getStats = () => api('/api/stats');
export const getApplications = () => api('/api/applications?limit=50');
export const getJobs = () => api('/api/jobs');
export const runManualApply = (body) => api('/api/apply', { method: 'POST', body: JSON.stringify(body) });
export const triggerScrape = (body) => api('/api/scrape', { method: 'POST', body: JSON.stringify(body) });
export const updateStatus = (id, status) =>
  api(`/api/applications/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
export const resendEmail = (id) => api(`/api/applications/${id}/send-email`, { method: 'POST' });
export const resetData = (scope) => api('/api/reset', { method: 'DELETE', body: JSON.stringify({ scope }) });
export const getProfile = () => api('/api/profile');

async function uploadFile(url, fieldName, file) {
  const formData = new FormData();
  formData.append(fieldName, file);
  const response = await fetch(url, { method: 'POST', body: formData });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || 'Upload failed');
  }
  return data;
}

export const uploadResume = (file) => uploadFile('/api/profile/resume', 'resume', file);

export const getHrContacts = (page = 1) => api(`/api/hr-contacts?page=${page}&limit=50`);
export const uploadHrList = (file) => uploadFile('/api/hr-contacts/upload', 'file', file);
export const setHrContactSent = (id, emailSent) =>
  api(`/api/hr-contacts/${id}`, { method: 'PATCH', body: JSON.stringify({ emailSent }) });
