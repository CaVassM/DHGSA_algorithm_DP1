import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { startPlanningRun } from '../services/api'

const UMBRALES = [
  { indicador: 'Almacenes',    verde: '< 60%',       ambar: '60% - 85%',       rojo: '> 85%' },
  { indicador: 'Vuelos',       verde: '50% - 70%',   ambar: '<50% o >70%',     rojo: '> 90%' },
  { indicador: 'Cumplimiento', verde: '> 95%',        ambar: '85% - 95%',       rojo: '< 85%' },
]

const PLANNING_REQUEST = {
  algorithm: 'IALNS_SA',
  scenario: 'PERIOD_SIMULATION',
  planningStart: '2026-07-14T00:00:00',
  horizonDays: 5,
  epochHours: 4,
  populationSize: 6,
  timeLimitSeconds: 2,
  dataSetReference: 'DEMO',
}

export default function ConfiguracionSimulacion() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleIniciar() {
    setLoading(true)
    setError(null)
    try {
      const response = await startPlanningRun(PLANNING_REQUEST)
      navigate('/dashboard', { state: { runId: response.runId } })
    } catch (err) {
      setError(err.response?.data?.message ?? 'No se pudo conectar con el servidor. Verifica que el backend esté corriendo.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white text-sm font-bold">T</span>
            </div>
            <span className="text-slate-400 text-sm font-medium uppercase tracking-widest">Tasf.B2B</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Configuración de Simulación</h1>
          <p className="text-slate-400 text-sm">Sistema de Gestión de Equipajes Extraviados</p>
        </div>

        {/* Card principal */}
        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden mb-4">

          {/* Parámetros */}
          <div className="p-6 border-b border-slate-700">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Parámetros de Simulación</h2>
            <div className="grid grid-cols-2 gap-4">
              <ParamCard label="Periodo a simular" value="5 días" icon="📅" />
              <ParamCard label="Algoritmo planificador" value="Genético (AG)" icon="🧬" />
              <ParamCard label="Duración estimada" value="~60 minutos" icon="⏱" />
              <ParamCard label="Carga inicial" value="20,485 maletas" icon="🧳" />
            </div>
          </div>

          {/* Tabla de umbrales */}
          <div className="p-6">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Umbrales de Semáforo</h2>
            <div className="rounded-xl overflow-hidden border border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700/50">
                    <th className="text-left px-4 py-3 text-slate-300 font-semibold">Indicador</th>
                    <th className="px-4 py-3 text-green-400 font-semibold text-center">Verde</th>
                    <th className="px-4 py-3 text-amber-400 font-semibold text-center">Ámbar</th>
                    <th className="px-4 py-3 text-red-400 font-semibold text-center">Rojo</th>
                  </tr>
                </thead>
                <tbody>
                  {UMBRALES.map((u, i) => (
                    <tr key={u.indicador} className={i % 2 === 0 ? 'bg-slate-800/50' : 'bg-slate-750/30'}>
                      <td className="px-4 py-3 text-white font-medium">{u.indicador}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block bg-green-500/15 text-green-400 border border-green-500/30 rounded px-2 py-0.5 text-xs font-mono">
                          {u.verde}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded px-2 py-0.5 text-xs font-mono">
                          {u.ambar}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block bg-red-500/15 text-red-400 border border-red-500/30 rounded px-2 py-0.5 text-xs font-mono">
                          {u.rojo}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Mensaje de error */}
        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Botón iniciar */}
        <button
          onClick={handleIniciar}
          disabled={loading}
          className="w-full py-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold text-base rounded-xl transition-colors duration-200 flex items-center justify-center gap-3 shadow-lg shadow-blue-900/40"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Iniciando simulación...
            </>
          ) : (
            <>
              <span className="text-lg">▶</span>
              Iniciar Simulación de 5 Días
            </>
          )}
        </button>

        <p className="text-center text-slate-500 text-xs mt-4">
          Los parámetros están fijados para este prototipo.
        </p>
      </div>
    </div>
  )
}

function ParamCard({ label, value, icon }) {
  return (
    <div className="bg-slate-700/40 rounded-xl p-4 border border-slate-600/50">
      <div className="text-xl mb-2">{icon}</div>
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-white font-semibold text-base">{value}</div>
    </div>
  )
}
