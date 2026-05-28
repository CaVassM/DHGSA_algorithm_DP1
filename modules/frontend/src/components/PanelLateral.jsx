import { useState, useEffect, useRef } from 'react'
import { SIMULACION, KPIS, LOG_EVENTOS, ATENCION_REQUERIDA } from '../data/simulacion'
import BarraProgreso from './BarraProgreso'
import SemaforoBadge from './SemaforoBadge'

const TERMINAL_STATUSES = new Set(['COMPLETED', 'COMPLETED_WITH_PENDING_SHIPMENTS', 'FAILED'])

const STATUS_CONFIG = {
  RUNNING:                          { label: 'Simulación en Curso',      dotClass: 'bg-green-500 animate-pulse', textClass: 'text-green-400' },
  COMPLETED:                        { label: 'Completado',                dotClass: 'bg-blue-500',                textClass: 'text-blue-400'  },
  COMPLETED_WITH_PENDING_SHIPMENTS: { label: 'Completado con Pendientes', dotClass: 'bg-amber-500',               textClass: 'text-amber-400' },
  FAILED:                           { label: 'Fallido',                   dotClass: 'bg-red-500',                 textClass: 'text-red-400'   },
}

const LOG_COLORES = {
  critico: 'text-red-400',
  alerta:  'text-amber-400',
  exito:   'text-green-400',
  info:    'text-slate-300',
}

function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

// ── Log persistence helpers ───────────────────────────────────────────────────

function logStorageKey(runId) { return `tasf_log_${runId}` }

function readLog(runId) {
  if (!runId) return []
  try { return JSON.parse(localStorage.getItem(logStorageKey(runId)) ?? '[]') } catch { return [] }
}

function writeLog(runId, entries) {
  if (!runId) return
  localStorage.setItem(logStorageKey(runId), JSON.stringify(entries))
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PanelLateral({ run }) {
  const isReal     = !!run
  const isTerminal = isReal && TERMINAL_STATUSES.has(run.status)
  const statusCfg  = isReal
    ? (STATUS_CONFIG[run.status] ?? STATUS_CONFIG.RUNNING)
    : { label: 'Simulación en Curso', dotClass: 'bg-green-500 animate-pulse', textClass: 'text-green-400' }

  // ── Log persistente ───────────────────────────────────────────────────────
  const [logHistory, setLogHistory] = useState([])
  const prevRunIdRef    = useRef(null)
  const prevMensajeRef  = useRef(null)

  // Cargar el historial guardado cuando cambia el run activo
  useEffect(() => {
    const rid = run?.id ?? null
    if (rid === prevRunIdRef.current) return
    prevRunIdRef.current   = rid
    prevMensajeRef.current = null
    setLogHistory(readLog(rid))
  }, [run?.id])

  // Acumular entradas nuevas cuando el mensaje del run cambia.
  // Lee desde localStorage (no desde el estado) para evitar condiciones de carrera
  // con el efecto de carga por runId que puede ejecutarse en el mismo batch de React.
  useEffect(() => {
    if (!run?.mensaje || !run?.id) return
    if (run.mensaje === prevMensajeRef.current) return
    prevMensajeRef.current = run.mensaje

    const entry = {
      hora:    formatTime(run.finishedAt ?? run.startedAt),
      tipo:    run.status === 'FAILED' ? 'critico' : run.status === 'RUNNING' ? 'info' : 'exito',
      mensaje: run.mensaje,
    }

    // Leer el historial actual desde localStorage (fuente de verdad siempre actualizada)
    const currentLog = readLog(run.id)
    if (currentLog.length > 0 && currentLog[0].mensaje === entry.mensaje) return
    const updated = [entry, ...currentLog]
    writeLog(run.id, updated)
    setLogHistory(updated)
  }, [run?.mensaje, run?.status, run?.id])

  // ── Valores derivados ─────────────────────────────────────────────────────

  const progresoPct   = isReal ? (isTerminal ? 100 : 50) : Math.round((SIMULACION.tiempoEjecucionMin / SIMULACION.tiempoTotalMin) * 100)
  const progresoLabel = isReal ? (isTerminal ? 'Finalizado' : 'En ejecución...') : `${SIMULACION.tiempoEjecucionMin} de ${SIMULACION.tiempoTotalMin} min`
  const progresoColor = isReal ? (isTerminal ? 'verde' : 'azul') : 'azul'

  const cumplimientoColor = KPIS.cumplimientoPlazos >= 95 ? 'verde' : KPIS.cumplimientoPlazos >= 85 ? 'ambar' : 'rojo'

  const logEntries = isReal ? logHistory : LOG_EVENTOS

  return (
    <aside className="w-72 shrink-0 flex flex-col bg-slate-900 border-l border-slate-700 overflow-y-auto">

      {/* Estado de la simulación */}
      <section className="p-4 border-b border-slate-700">
        <div className="flex items-center gap-2 mb-3">
          <span className={`w-2.5 h-2.5 rounded-full ${statusCfg.dotClass}`} />
          <span className={`text-xs font-semibold uppercase tracking-wider ${statusCfg.textClass}`}>
            {statusCfg.label}
          </span>
        </div>
        <div className="space-y-2 text-sm">
          {isReal ? (
            <>
              <Row label="Algoritmo" value={run.algorithm} />
              <Row label="Dataset"   value={run.dataSetReference} />
            </>
          ) : (
            <>
              <Row label="Tiempo simulado" value={`Día ${SIMULACION.diaActual} de ${SIMULACION.diasTotal}`} />
              <Row label="Hora simulada"   value={SIMULACION.horaSimulada} />
            </>
          )}
          <div>
            <div className="flex justify-between text-slate-400 text-xs mb-1">
              <span>Ejecución</span>
              <span>{progresoLabel}</span>
            </div>
            <BarraProgreso pct={progresoPct} color={progresoColor} height="h-2" />
          </div>
          {isReal ? (
            <>
              <Row label="Iniciado"   value={formatTime(run.startedAt)} />
              <Row label="Finalizado" value={isTerminal ? formatTime(run.finishedAt) : '—'} />
            </>
          ) : (
            <>
              <Row label="Término estimado" value={`en ${SIMULACION.terminaEn}`} />
              <Row label="Algoritmo"        value={SIMULACION.algoritmo} />
            </>
          )}
        </div>
      </section>

      {/* KPIs */}
      <section className="p-4 border-b border-slate-700">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Estado Actual</h3>
        <div className="space-y-2.5">
          {isReal ? (
            <>
              <KpiRow label="Envíos asignados"    value={(run.totalEnviosAsignados   ?? 0).toLocaleString()} color="verde" />
              <KpiRow label="Envíos pendientes"   value={(run.totalEnviosNoAsignados ?? 0).toLocaleString()} color="ambar" />
              <KpiRow label="Maletas despachadas" value={(run.totalMaletasDespachadas ?? 0).toLocaleString()} color="azul" />
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-xs">Costo total</span>
                <span className="font-mono font-bold text-sm text-white">
                  {(run.costoTotal ?? 0).toLocaleString('es', { maximumFractionDigits: 1 })}
                </span>
              </div>
            </>
          ) : (
            <>
              <KpiRow label="Maletas en tránsito" value={KPIS.maletasTransito.toLocaleString()}  color="azul" />
              <KpiRow label="Maletas pendientes"  value={KPIS.maletasPendientes.toLocaleString()} color="ambar" />
              <KpiRow label="Maletas entregadas"  value={KPIS.maletasEntregadas.toLocaleString()}  color="verde" />
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-xs">Cumplimiento de plazos</span>
                <span className={`font-mono font-bold text-sm ${cumplimientoColor === 'verde' ? 'text-green-400' : cumplimientoColor === 'ambar' ? 'text-amber-400' : 'text-red-400'}`}>
                  {KPIS.cumplimientoPlazos}%
                </span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Log de eventos */}
      <section className="p-4 border-b border-slate-700 flex-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          {isReal
            ? `Log de Eventos${logHistory.length > 0 ? ` (${logHistory.length})` : ''}`
            : `Log de Eventos — Día ${SIMULACION.diaActual}`}
        </h3>
        <ul className="space-y-2.5">
          {logEntries.length === 0 ? (
            <li className="text-xs text-slate-500">
              {isReal ? 'Esperando eventos del servidor...' : 'Sin eventos registrados.'}
            </li>
          ) : (
            logEntries.map((ev, i) => (
              <li key={i} className="text-xs leading-snug">
                <span className="text-slate-500 font-mono mr-1">{ev.hora}</span>
                <span className={LOG_COLORES[ev.tipo] ?? 'text-slate-300'}>{ev.mensaje}</span>
              </li>
            ))
          )}
        </ul>
      </section>

      {/* Atención requerida — mock estático (el backend no provee esto aún) */}
      <section className="p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Atención Requerida</h3>
        <ul className="space-y-2">
          {ATENCION_REQUERIDA.map((item) => (
            <li key={item.codigo} className="flex items-start gap-2">
              <SemaforoBadge
                color={item.nivel === 'critico' ? 'rojo' : 'ambar'}
                label={item.nivel === 'critico' ? 'CRÍTICO' : 'VIGILAR'}
              />
              <div className="text-xs">
                <span className="font-semibold text-white">{item.codigo}</span>
                <span className="text-slate-400 ml-1">— {item.mensaje}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

    </aside>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-200 font-medium">{value}</span>
    </div>
  )
}

function KpiRow({ label, value, color }) {
  const textColor = { verde: 'text-green-400', ambar: 'text-amber-400', rojo: 'text-red-400', azul: 'text-blue-400' }[color] ?? 'text-white'
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-400 text-xs">{label}</span>
      <span className={`font-mono font-bold text-sm ${textColor}`}>{value}</span>
    </div>
  )
}
