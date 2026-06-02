import { useEffect, useState } from 'react';
import {
  listAllComptes,
  listComptesByClient,
  getCompte,
  createCompte,
} from '../api.js';

export default function Comptes() {
  const [comptes, setComptes] = useState([]);
  const [byClientId, setByClientId] = useState('');
  const [searchId, setSearchId] = useState('');
  const [found, setFound] = useState(null);
  const [form, setForm] = useState({ id: '', solde: '', idclient: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const reload = async () => {
    try {
      setError('');
      const data = await listAllComptes();
      setComptes(data || []);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { reload(); }, []);

  const byClient = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const data = await listComptesByClient(byClientId);
      setComptes(data || []);
    } catch (e) {
      setError(e.message);
    }
  };

  const search = async (e) => {
    e.preventDefault();
    setError(''); setFound(null);
    try {
      const c = await getCompte(searchId);
      setFound(c);
    } catch (e) {
      setError(e.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await createCompte({
        id: Number(form.id),
        solde: Number(form.solde),
        idclient: Number(form.idclient),
      });
      setSuccess(`Compte ${form.id} créé`);
      setForm({ id: '', solde: '', idclient: '' });
      reload();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div>
      <div className="card">
        <h2>GET /api/comptes/all — tous les comptes</h2>
        <button onClick={reload}>Rafraîchir</button>
        {comptes.length === 0 ? (
          <div className="empty">Aucun compte</div>
        ) : (
          <table>
            <thead><tr><th>ID</th><th>Solde</th><th>ID Client</th></tr></thead>
            <tbody>
              {comptes.map(c => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td>{c.solde}</td>
                  <td>{c.idclient}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>GET /api/comptes?client={'{id}'} — comptes d'un client</h2>
        <form onSubmit={byClient} className="form-row">
          <input
            placeholder="ID client"
            value={byClientId}
            onChange={(e) => setByClientId(e.target.value)}
            required
          />
          <button type="submit">Filtrer</button>
        </form>
      </div>

      <div className="card">
        <h2>GET /api/comptes/{'{id}'} — récupérer un compte</h2>
        <form onSubmit={search} className="form-row">
          <input
            placeholder="ID compte"
            value={searchId}
            onChange={(e) => setSearchId(e.target.value)}
            required
          />
          <button type="submit">Rechercher</button>
        </form>
        {found && <pre>{JSON.stringify(found, null, 2)}</pre>}
      </div>

      <div className="card">
        <h2>POST /api/comptes — créer un compte</h2>
        <form onSubmit={submit}>
          <div className="form-row">
            <input
              type="number" placeholder="ID compte"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              required
            />
            <input
              type="number" step="0.01" placeholder="Solde"
              value={form.solde}
              onChange={(e) => setForm({ ...form, solde: e.target.value })}
              required
            />
            <input
              type="number" placeholder="ID client"
              value={form.idclient}
              onChange={(e) => setForm({ ...form, idclient: e.target.value })}
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
