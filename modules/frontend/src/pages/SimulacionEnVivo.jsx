import { useState, useEffect, useRef, useCallback } from 'react'
import NavBar from '../components/NavBar'
import { iniciarSimulacionEnVivo, cancelarSimulacionEnVivo } from '../services/api'
import { suscribirSimulacion } from '../services/simulacionSocket'

// Simulación de periodo EN VIVO (salto de algoritmo).
// Arranca la simulación y muestra el avance época a época que llega por
// WebSocket: barra de progreso, reloj simulado, métricas y ocupación de
// almacenes con semáforo.

function colorOcup(pct) {
  if (pct >= 85) return { txt: 'text-red-400', bar: 'bg-red-500' }
  if (pct >= 60) return { txt: 'text-amber-400', bar: 'bg-amber-500' }
  return { txt: 'text-green-400', bar: 'bg-green-500' }
}

const MULTIPLICADORES = [60, 120, 240, 480]

export default function SimulacionEnVivo() {
  const [estado, setEstado] = useState('idle') // idle | corriendo | fin | error
  const [multiplicador, setMultiplicador] = useState(240)
  const [algoritmo, setAlgoritmo] = useState('DHGS')
  const [planningStart, setPlanningStart] = useState('2026-01-02T00:00')
  const [horizonDays, setHorizonDays] = useState(2)

  const [evento, setEvento] = useState(null)          // último evento de época
  const [eventos, setEventos] = useState([])          // historial de épocas
  const [mensaje, setMensaje] = useState(null)
  const [runId, setRunId] = useState(null)

  const disconnectRef = useRef(null)

  useEffect(() => () => { disconnectRef.current?.() }, [])

  const arrancar = useCallback(async () => {
    setEstado('corriendo'); setEvento(null); setEventos([]); setMensaje(null)
    try {
      const { runId, topic } = await iniciarSimulacionEnVivo({
        algorithm: algoritmo,
        planningStart: planningStart ? `${planningStart}:00` : null,
        epochHours: 4,
        horizonDays,
        populationSize: 4,
        timeLimitSeconds: 1,
        multiplicadorTemporal: multiplicador,
      })
      setRunId(runId)
      disconnectRef.current = suscribirSimulacion(topic, (ev) => {
        if (ev.tipo === 'EPOCA') {
          setEvento(ev)
          setEventos(prev => [...prev, ev])
        } else if (ev.tipo === 'INICIO') {
          setMensaje(ev.mensaje)
        } else if (ev.tipo === 'FIN') {
          setMensaje(ev.mensaje); setEstado('fin')
        } else if (ev.tipo === 'ERROR') {
          setMensaje(ev.mensaje); setEstado('error')
        }
      })
    } catch {
      setMensaje('No se pudo iniciar la simulación. ¿Backend arriba y datos cargados?')
      setEstado('error')
    }
  }, [algoritmo, planningStart, horizonDays, multiplicador])

  const cancelar = useCallback(async () => {
    if (runId) { try { await cancelarSimulacionEnVivo(runId) } catch { /* noop */ } }
    disconnectRef.current?.(); setEstado('fin')
  }, [runId])

  const progreso = evento ? (evento.numeroEpoca / evento.totalEpocas) * 100 : 0
  const almacenes = evento?.ocupacionAlmacenes
    ? Object.entries(evento.ocupacionAlmacenes).sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200">
      <NavBar />
      <div className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Config + control */}
        <div className="space-y-6">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Simulación de periodo en vivo</h2>

            <label className="block text-xs text-slate-400 mb-1.5">Algoritmo</label>
            <select value={algoritmo} onChange={e => setAlgoritmo(e.target.value)} disabled={estado === 'corriendo'}
              className="w-full mb-3 px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50">
              <option value="DHGS">DHGS (genético)</option>
              <option value="IALNS">IALNS (ALNS + SA)</option>
            </select>

            <label className="block text-xs text-slate-400 mb-1.5">Inicio de planificación</label>
            <input type="datetime-local" value={planningStart} onChange={e => setPlanningStart(e.target.value)} disabled={estado === 'corriendo'}
              className="w-full mb-3 px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50" />

            <label className="block text-xs text-slate-400 mb-1.5">Días a simular</label>
            <input type="number" min="1" max="14" value={horizonDays} onChange={e => setHorizonDays(Number(e.target.value))} disabled={estado === 'corriendo'}
              className="w-full mb-3 px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50" />

            <label className="block text-xs text-slate-400 mb-1.5">Multiplicador temporal (velocidad)</label>
            <div className="flex gap-2 mb-4">
              {MULTIPLICADORES.map(m => (
                <button key={m} onClick={() => setMultiplicador(m)} disabled={estado === 'corriendo'}
                  className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                    multiplicador === m ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'} disabled:opacity-50`}>
                  x{m}
                </button>
              ))}
            </div>

            {estado !== 'corriendo' ? (
              <button onClick={arrancar}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-2">
                <span>▶</span> Iniciar simulación
              </button>
            ) : (
              <button onClick={cancelar}
                className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-semibold text-sm rounded-xl transition-colors">
                ■ Detener
              </button>
            )}
          </div>

          {/* Métricas acumuladas */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Acumulado</h2>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Asignados" value={evento?.totalAsignadosAcumulado ?? 0} clr="text-green-400" />
              <Metric label="Costo" value={Math.round(evento?.costoAcumulado ?? 0)} clr="text-blue-400" />
            </div>
          </div>
        </div>

        {/* Progreso + almacenes */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Avance de la simulación</h2>
              <span className={`text-xs font-medium ${
                estado === 'corriendo' ? 'text-blue-400' : estado === 'fin' ? 'text-green-400' : estado === 'error' ? 'text-red-400' : 'text-slate-500'}`}>
                {estado === 'corriendo' ? '● en vivo' : estado === 'fin' ? '✓ finalizada' : estado === 'error' ? '✕ error' : 'lista'}
              </span>
            </div>

            {/* Reloj simulado */}
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-3xl font-bold font-mono text-white">
                {evento?.relojSimulado ? String(evento.relojSimulado).replace('T', ' ').slice(0, 16) : '—'}
              </span>
              <span className="text-xs text-slate-500">reloj simulado</span>
            </div>

            {/* Barra de progreso */}
            <div className="h-3 rounded-full bg-slate-700 overflow-hidden mb-2">
              <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${progreso}%` }} />
            </div>
            <div className="flex justify-between text-xs text-slate-400 mb-3">
              <span>Época {evento?.numeroEpoca ?? 0} / {evento?.totalEpocas ?? '—'}</span>
              <span>{evento ? `${Math.round(progreso)}%` : ''}</span>
            </div>

            {evento && (
              <div className="grid grid-cols-3 gap-3">
                <Metric label="Despachados (época)" value={evento.enviosDespachados} clr="text-green-400" />
                <Metric label="Pendientes" value={evento.enviosPostpuestos} clr="text-amber-400" />
                <Metric label="Rutas (época)" value={evento.rutas?.length ?? 0} clr="text-blue-400" />
              </div>
            )}

            {mensaje && <p className="mt-3 text-xs text-slate-400">{mensaje}</p>}
          </div>

          {/* Ocupación de almacenes (semáforo) */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Ocupación de almacenes</h2>
            {almacenes.length === 0 ? (
              <p className="text-sm text-slate-500">Sin datos todavía. Inicia la simulación.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto">
                {almacenes.map(([icao, pct]) => {
                  const c = colorOcup(pct)
                  return (
                    <div key={icao} className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-400 w-12">{icao}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                        <div className={`h-full ${c.bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <span className={`text-xs font-mono w-10 text-right ${c.txt}`}>{pct.toFixed(0)}%</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, clr }) {
  return (
    <div className="bg-slate-700/40 rounded-lg px-3 py-2.5 border border-slate-600/50 text-center">
      <div className={`text-xl font-bold font-mono leading-none ${clr}`}>{Number(value).toLocaleString()}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  )
}
