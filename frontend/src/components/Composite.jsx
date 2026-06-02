import { useState } from 'react';
import { getClientWithComptes, createCompteForClient } from '../api.js';

export default function Composite() {
  const [clientId, setClientId] = useState('');
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({ targetClient: '', id: '', solde: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchClient = async (e) => {
    e.preventDefault();
    setError(''); setResult(null);
    try {
      const data = await getClientWithComptes(clientId);
      setResult(data);
    } catch (e) {
      setError(e.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      const created = await createCompteForClient(form.targetClient, {
        id: Number(form.id),
        solde: Number(form.solde),
        idclient: Number(form.targetClient),
      });
      setSuccess(`Compte ${created.id} créé pour client ${form.targetClient}`);
      setForm({ targetClient: '', id: '', solde: '' });
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div>
      <div className="card">
        <h2>GET /api/clientscomptes/{'{id}'} — client + ses comptes</h2>
        <form onSubmit={fetchClient} className="form-row">
          <input
            placeholder="ID client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            required
          />
          <button type="submit">Récupérer</button>
        </form>

        {result && (
          <>
            <p><strong>{result.prenom} {result.nom}</strong> (id : {result.id})</p>
            {result.comptes && result.comptes.length > 0 ? (
              <table>
                <thead><tr><th>ID compte</th><th>Solde</th></tr></thead>
                <tbody>
                  {result.comptes.map(c => (
                    <tr key={c.id}><td>{c.id}</td><td>{c.solde}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty">Aucun compte pour ce client</div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>POST /api/clientscomptes/{'{id}'} — créer un compte pour un client</h2>
        <p style={{ color: '#666', fontSize: 13 }}>
          Vérifie d'abord que le client existe, puis crée le compte associé.
        </p>
        <form onSubmit={submit}>
          <div className="form-row">
            <input
              type="number" placeholder="ID client cible"
              value={form.targetClient}
              onChange={(e) => setForm({ ...form, targetClient: e.target.value })}
              required
            />
            <input
              type="number" placeholder="ID nouveau compte"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              required
            />
            <input
              type="number" step="0.01" placeholder="Solde initial"
              value={form.solde}
              onChange={(e) => setForm({ ...form, solde: e.target.value })}
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
