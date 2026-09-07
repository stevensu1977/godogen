import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { RunList } from './components/RunList';
import { RunView } from './components/RunView';

function DuckLogo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden>
      <ellipse cx="15" cy="21" rx="11" ry="7.5" fill="#f2c14e" />
      <circle cx="22" cy="12" r="6" fill="#f2c14e" />
      <polygon points="27,12 33,14 27,16" fill="#f5792a" />
      <circle cx="24" cy="11" r="1.2" fill="#1a1405" />
    </svg>
  );
}

function RunRoute() {
  const { id } = useParams();
  if (!id) return <Navigate to="/" replace />;
  return <RunView runId={id} />;
}

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand"><DuckLogo /> Godogen Studio</Link>
        <Routes>
          <Route path="/runs/:id" element={<span className="crumb">/ <b>run</b></span>} />
          <Route path="*" element={null} />
        </Routes>
        <span className="spacer" />
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<RunList />} />
          <Route path="/runs/:id" element={<RunRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
