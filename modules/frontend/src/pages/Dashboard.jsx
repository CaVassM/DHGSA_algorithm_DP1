import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import NavBar from '../components/NavBar'
import PanelLateral from '../components/PanelLateral'
import MapaMundi from '../components/MapaMundi'
import EnviosEnVuelo from '../components/EnviosEnVuelo'
import { getPlanningRun } from '../services/api'

const TERMINAL_STATUSES = new Set(['COMPLETED', 'COMPLETED_WITH_PENDING_SHIPMENTS', 'FAILED'])

const LS_KEY = 'tasf_runId'

export default function Dashboard() {
  const location = useLocation()
  const stored   = localStorage.getItem(LS_KEY)
  const runId    = location.state?.runId ?? (stored ? Number(stored) : null)
  const [run, setRun] = useState(null)
  const [enVuelo, setEnVuelo] = useState([]) // T41: envíos actualmente en tránsito
  const intervalRef = useRef(null)

  // Persistir el runId para que sobreviva recargas y navegación entre páginas
  useEffect(() => {
    if (runId != null) localStorage.setItem(LS_KEY, String(runId))
  }, [runId])

  useEffect(() => {
    if (!runId) return

    async function poll() {
      try {
        const data = await getPlanningRun(runId)
        setRun(data)
        if (TERMINAL_STATUSES.has(data.status)) {
          clearInterval(intervalRef.current)
        }
      } catch {
        // mantener el polling ante errores de red transitorios
      }
    }

    poll()
    intervalRef.current = setInterval(poll, 3000)
    return () => clearInterval(intervalRef.current)
  }, [runId])

  return (
    <div className="h-screen flex flex-col bg-[#0f172a] overflow-hidden">
      <NavBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Mapa */}
        <main className="flex-1 relative overflow-hidden p-1">
          <MapaMundi
            runId={runId}
            runCompleted={!!(run && TERMINAL_STATUSES.has(run.status))}
            onActiveLegsChange={setEnVuelo}
          />
          {/* T41: lista de envíos actualmente en vuelo (sobre el mapa) */}
          <EnviosEnVuelo envios={enVuelo} />
          {/* Leyenda */}
          <div className="absolute bottom-4 left-4 z-[1000] flex gap-3 bg-slate-900/80 backdrop-blur rounded-lg px-4 py-2 border border-slate-700 shadow-lg">
            <LeyendaItem color="bg-slate-400" label="Vacío (0 maletas)" />
            <LeyendaItem color="bg-green-500" label="Óptimo (<60%)" />
            <LeyendaItem color="bg-amber-500" label="Riesgo (60–85%)" />
            <LeyendaItem color="bg-red-500" label="Crítico (>85%)" />
            <LeyendaItem color="bg-blue-500" label="Vuelo en tránsito" />
          </div>
        </main>
        <PanelLateral run={run} />
      </div>
    </div>
  )
}

function LeyendaItem({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-3 h-3 rounded-full ${color}`} />
      <span className="text-slate-300 text-xs">{label}</span>
    </div>
  )
}
