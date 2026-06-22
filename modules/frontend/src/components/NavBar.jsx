import { useNavigate, useLocation } from 'react-router-dom'

export default function NavBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const esDashboard = location.pathname === '/dashboard'
  const esIndicadores = location.pathname === '/indicadores'
  const esDiaADia = location.pathname === '/dia-a-dia'

  return (
    <header className="flex items-center justify-between px-6 py-3 bg-slate-900 border-b border-slate-700 shrink-0">
      <div>
        <span className="text-xl font-bold text-white tracking-wide">Tasf.B2B</span>
        <span className="ml-3 text-xs text-slate-400 uppercase tracking-widest">Operaciones Globales</span>
      </div>
      <nav className="flex gap-1">
        <button
          onClick={() => navigate('/dashboard')}
          className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
            esDashboard
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-700'
          }`}
        >
          Mapa en Vivo
        </button>
        <button
          onClick={() => navigate('/indicadores')}
          className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
            esIndicadores
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-700'
          }`}
        >
          Indicadores Globales
        </button>
        <button
          onClick={() => navigate('/dia-a-dia')}
          className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
            esDiaADia
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-700'
          }`}
        >
          Operación Día a Día
        </button>
      </nav>
    </header>
  )
}
