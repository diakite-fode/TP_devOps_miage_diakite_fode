// Toutes les requêtes passent par le proxy Vite (/api → http://localhost:10000)

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---- Clients (ClientsService) ----
export const listClients = () => request('/api/clients');
export const getClient = (id) => request(`/api/clients/${id}`);
export const createClient = (client) =>
  request('/api/clients', { method: 'POST', body: JSON.stringify(client) });

// ---- Comptes (ComptesService) ----
export const listAllComptes = () => request('/api/comptes/all');
export const listComptesByClient = (clientId) =>
  request(`/api/comptes?client=${clientId}`);
export const getCompte = (id) => request(`/api/comptes/${id}`);
export const createCompte = (compte) =>
  request('/api/comptes', { method: 'POST', body: JSON.stringify(compte) });

// ---- Composite (ClientsComptes) ----
export const getClientWithComptes = (id) =>
  request(`/api/clientscomptes/${id}`);
export const createCompteForClient = (clientId, compte) =>
  request(`/api/clientscomptes/${clientId}`, {
    method: 'POST',
    body: JSON.stringify(compte),
  });
