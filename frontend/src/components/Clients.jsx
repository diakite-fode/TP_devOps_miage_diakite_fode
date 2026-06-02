import { useEffect, useState } from 'react';
import { listClients, getClient, createClient } from '../api.js';

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState({ id: '', nom: '', prenom: '' });
  const [searchId, setSearchId] = useState('');
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const reload = async () => {
    try {
      setError('');
      const data = await listClients();
      setClients(data || []);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { reload(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await createClient({
        id: Number(form.id),
        nom: form.nom,
        prenom: form.prenom,
      });
      setSuccess(`Client ${form.id} créé`);
      setForm({ id: '', nom: '', prenom: '' });
      reload();
    } catch (e) {
      setError(e.message);
    }
  };

  const search = async (e) => {
    e.preventDefault();
    setError(''); setFound(null);
    try {
      const c = await getClient(searchId);
      setFound(c);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div>
      <div className="card">
        <h2>GET /api/clients — liste des clients</h2>
        <button onClick={reload}>Rafraîchir</button>
        {clients.length === 0 ? (
          <div className="empty">Aucun client</div>
        ) : (
          <table>
            <thead><tr><th>ID</th><th>Nom</th><th>Prénom</th></tr></thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.id}><td>{c.id}</td><td>{c.nom}</td><td>{c.prenom}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>GET /api/clients/{'{id}'} — récupérer un client</h2>
        <form onSubmit={search} className="form-row">
          <input
            placeholder="ID client"
            value={searchId}
            onChange={(e) => setSearchId(e.target.value)}
            required
          />
          <button type="submit">Rechercher</button>
        </form>
        {found && <pre>{JSON.stringify(found, null, 2)}</pre>}
      </div>

      <div className="card">
        <h2>POST /api/clients — créer un client</h2>
        <form onSubmit={submit}>
          <div className="form-row">
            <input
              type="number" placeholder="ID"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              required
            />
            <input
              placeholder="Nom"
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              required
            />
            <input
              placeholder="Prénom"
              value={form.prenom}
              onChange={(e) => setForm({ ...form, prenom: e.target.value })}
              required
            />
            <button type="submit">Créer</button>
          </div>
        </form>
      </div>

      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}
    </div>
  );
}
