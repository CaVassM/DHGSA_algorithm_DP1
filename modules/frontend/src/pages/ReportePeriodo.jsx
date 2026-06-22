import { useState, useEffect } from 'react'
import NavBar from '../components/NavBar'
import { getPlanningRun } from '../services/api'

const LS_KEY = 'tasf_runId'

// T63: reporte formal de la última planificación estable (fin de periodo).
// Presenta los KPIs persistidos de la corrida de forma legible e imprimible.

function fmt(dt) {
  if (!dt) return '—'
  return String(dt).replace('T', ' ').slice(0, 19)
}

const STATUS_LABEL = {
  COMPLETED: 'Completado',
  COMPLETED_WITH_PENDING_SHIPMENTS: 'Completado con pendientes',
  FAILED: 'Fallido',
  RUNNING: 'En ejecución',
}

export default function ReportePeriodo() {
  const runId = (() => {
    const s = localStorage.getItem(LS_KEY)
    return s ? Number(s) : null
  })()

  const [run, setRun] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!runId) { setError('No hay una corrida seleccionada. Inicia una simulación primero.'); return }
    getPlanningRun(runId)
      .then(setRun)
      .catch(() => setError('No se pudo cargar la corrida.'))
  }, [runId])

  const totalEnvios = run ? (run.totalEnviosAsignados ?? 0) + (run.totalEnviosNoAsignados ?? 0) : 0
  const cumplimiento = totalEnvios > 0 ? Math.round((run.totalEnviosAsignados / totalEnvios) * 1000) / 10 : 0
  const cumColor = cumplimiento >= 95 ? 'text-green-400' : cumplimiento >= 85 ? 'text-amber-400' : 'text-red-400'
  const duracionSeg = run?.startedAt && run?.finishedAt
    ? Math.max(0, (new Date(run.finishedAt) - new Date(run.startedAt)) / 1000)
    : null

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col">
      <div className="print:hidden"><NavBar /></div>
      <div className="flex-1 p-6 max-w-3xl mx-auto w-full">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Reporte de Planificación</h1>
            <p className="text-slate-400 text-sm">Resumen formal de la última corrida estable</p>
          </div>
          <button
            onClick={() => window.print()}
            className="print:hidden px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            🖨 Imprimir / PDF
          </button>
        </div>

        {error && (
          <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm">{error}</div>
        )}

        {run && (
          <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden print:bg-white print:text-black">
            {/* Cabecera del reporte */}
            <div className="px-6 py-5 border-b border-slate-700 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-widest">Corrida #{run.id}</div>
                <div className="text-lg font-bold text-white print:text-black">{STATUS_LABEL[run.status] ?? run.status}</div>
              </div>
              <div className="text-right text-xs text-slate-400">
                <div>Algoritmo: <span className="text-slate-200 font-mono">{run.algorithm}</span></div>
                <div>Escenario: <span className="text-slate-200 font-mono">{run.scenario}</span></div>
                <div>Dataset: <span className="text-slate-200 font-mono">{run.dataSetReference}</span></div>
              </div>
            </div>

            {/* Cumplimiento destacado */}
            <div className="px-6 py-6 border-b border-slate-700 text-center">
              <div className="text-xs text-slate-400 uppercase tracking-widest mb-1">Cumplimiento de plazos</div>
              <div className={`text-5xl font-bold ${cumColor}`}>{cumplimiento}%</div>
              <div className="text-xs text-slate-500 mt-1">
                {run.totalEnviosAsignados ?? 0} de {totalEnvios} envíos asignados
              </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-slate-700">
              <Kpi label="Envíos asignados" value={(run.totalEnviosAsignados ?? 0).toLocaleString()} clr="text-green-400" />
              <Kpi label="Envíos pendientes" value={(run.totalEnviosNoAsignados ?? 0).toLocaleString()} clr="text-amber-400" />
              <Kpi label="Maletas despachadas" value={(run.totalMaletasDespachadas ?? 0).toLocaleString()} clr="text-blue-400" />
              <Kpi label="Costo total" value={(run.costoTotal ?? 0).toLocaleString('es', { maximumFractionDigits: 0 })} clr="text-white" />
              <Kpi label="Duración" value={duracionSeg != null ? `${duracionSeg.toFixed(1)} s` : '—'} clr="text-white" />
              <Kpi label="Total envíos" value={totalEnvios.toLocaleString()} clr="text-slate-300" />
            </div>

            {/* Tiempos */}
            <div className="px-6 py-4 border-t border-slate-700 text-sm space-y-1">
              <Linea k="Iniciado" v={fmt(run.startedAt)} />
              <Linea k="Finalizado" v={fmt(run.finishedAt)} />
              {run.mensaje && <Linea k="Mensaje" v={run.mensaje} />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Kpi({ label, value, clr }) {
  return (
    <div className="bg-slate-800 px-4 py-4 text-center print:bg-white">
      <div className={`text-2xl font-bold font-mono ${clr}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  )
}

function Linea({ k, v }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-400">{k}</span>
      <span className="text-slate-200 font-mono text-right">{v}</span>
    </div>
  )
}
