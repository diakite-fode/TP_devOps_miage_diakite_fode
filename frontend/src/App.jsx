import { useState } from 'react';
import Clients from './components/Clients.jsx';
import Comptes from './components/Comptes.jsx';
import Composite from './components/Composite.jsx';

const TABS = [
  { id: 'clients', label: 'Clients', component: Clients },
  { id: 'comptes', label: 'Comptes', component: Comptes },
  { id: 'composite', label: 'Client + Comptes (composite)', component: Composite },
];

export default function App() {
  const [active, setActive] = useState('clients');
  const ActiveTab = TABS.find(t => t.id === active).component;

  return (
    <div className="app">
      <h1>🏦 Banque MS — Console</h1>
      <p className="subtitle">
        Console front-end consommant l'API Gateway (port 10000) du projet microservices.
      </p>

      <div className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab ${active === t.id ? 'active' : ''}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ActiveTab />
    </div>
  );
}
