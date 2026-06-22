import { useState, useEffect, useRef, useCallback } from 'react'
import NavBar from '../components/NavBar'
import { iniciarSimulacionColapso, cancelarSimulacionEnVivo } from '../services/api'
import { suscribirSimulacion } from '../services/simulacionSocket'

// Simulación de colapso logístico (escenario COLLAPSE_SIMULATION).
// Multiplica la carga existente hasta saturar el sistema; muestra cómo los
// almacenes se ponen rojos y, al colapsar, presenta un reporte final.

function colorOcup(pct) {
  if (pct >= 100) return { txt: 'text-red-500', bar: 'bg-red-600' }
  if (pct >= 85) return { txt: 'text-red-400', bar: 'bg-red-500' }
  if (pct >= 60) return { txt: 'text-amber-400', bar: 'bg-amber-500' }
  return { txt: 'text-green-400', bar: 'bg-green-500' }
}

const FACTORES = [2, 5, 10, 20]

export default function SimulacionColapso() {
  const [estado, setEstado] = useState('idle') // idle | corriendo | colapso | fin | error
  const [factorCarga, setFactorCarga] = useState(5)
  const [algoritmo, setAlgoritmo] = useState('DHGS')
  const [planningStart] = useState('2026-01-02T00:00')
  const [horizonDays] = useState(2)

  const [evento, setEvento] = useState(null)
  const [reporte, setReporte] = useState(null)
  const [mensaje, setMensaje] = useState(null)
  const [runId, setRunId] = useState(null)

  const disconnectRef = useRef(null)
  useEffect(() => () => { disconnectRef.current?.() }, [])

  const arrancar = useCallback(async () => {
    setEstado('corriendo'); setEvento(null); setReporte(null); setMensaje(null)
    try {
      const { runId, topic } = await iniciarSimulacionColapso({
        algorithm: algoritmo,
        planningStart: `${planningStart}:00`,
        epochHours: 4,
        horizonDays,
        populationSize: 4,
        timeLimitSeconds: 1,
        multiplicadorTemporal: 480,
        factorCarga,
        umbralColapso: 40,
      })
      setRunId(runId)
      disconnectRef.current = suscribirSimulacion(topic, (ev) => {
        if (ev.tipo === 'EPOCA') setEvento(ev)
        else if (ev.tipo === 'INICIO') setMensaje(ev.mensaje)
        else if (ev.tipo === 'COLAPSO') {
          setEvento(ev); setReporte(ev.reporteColapso); setMensaje(ev.mensaje); setEstado('colapso')
        } else if (ev.tipo === 'FIN') {
          if (ev.reporteColapso) setReporte(ev.reporteColapso)
          setMensaje(ev.mensaje); setEstado('fin')
        } else if (ev.tipo === 'ERROR') {
          setMensaje(ev.mensaje); setEstado('error')
        }
      })
    } catch {
      setMensaje('No se pudo iniciar. ¿Backend arriba y datos cargados?'); setEstado('error')
    }
  }, [algoritmo, planningStart, horizonDays, factorCarga])

  const detener = useCallback(async () => {
    if (runId) { try { await cancelarSimulacionEnVivo(runId) } catch { /* noop */ } }
    disconnectRef.current?.(); setEstado('fin')
  }, [runId])

  const almacenes = evento?.ocupacionAlmacenes
    ? Object.entries(evento.ocupacionAlmacenes).sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200">
      <NavBar />
      <div className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Config */}
        <div className="space-y-6">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Simulación de colapso</h2>
            <p className="text-xs text-slate-500 mb-4">
              Multiplica la carga real hasta saturar el sistema y ver cuándo colapsa.
            </p>

            <label className="block text-xs text-slate-400 mb-1.5">Algoritmo</label>
            <select value={algoritmo} onChange={e => setAlgoritmo(e.target.value)} disabled={estado === 'corriendo'}
              className="w-full mb-3 px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50">
              <option value="DHGS">DHGS (genético)</option>
              <option value="IALNS">IALNS (ALNS + SA)</option>
            </select>

            <label className="block text-xs text-slate-400 mb-1.5">Factor de carga (×)</label>
            <div className="flex gap-2 mb-4">
              {FACTORES.map(f => (
                <button key={f} onClick={() => setFactorCarga(f)} disabled={estado === 'corriendo'}
                  className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                    factorCarga === f ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'} disabled:opacity-50`}>
                  x{f}
                </button>
              ))}
            </div>

            {estado !== 'corriendo' ? (
              <button onClick={arrancar}
                className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-2">
                <span>▶</span> Iniciar colapso
              </button>
            ) : (
              <button onClick={detener}
                className="w-full py-3 bg-slate-600 hover:bg-slate-500 text-white font-semibold text-sm rounded-xl transition-colors">
                ■ Detener
              </button>
            )}
          </div>

          {/* Reporte de colapso */}
          {reporte && (
            <div className={`rounded-2xl border p-5 ${reporte.colapso ? 'bg-red-500/10 border-red-500/40' : 'bg-slate-800 border-slate-700'}`}>
              <h2 className="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-2">
                {reporte.colapso ? <span className="text-red-400">⚠ Reporte de colapso</span> : <span className="text-slate-400">Reporte final</span>}
              </h2>
              <p className="text-sm text-slate-300 mb-3">{reporte.motivo}</p>
              <div className="space-y-1.5 text-sm">
                <Linea k="Factor de carga" v={`x${reporte.factorCarga}`} />
                <Linea k="Envíos cargados" v={reporte.totalEnviosCargados.toLocaleString()} />
                <Linea k="Atendidos" v={reporte.totalAsignados.toLocaleString()} clr="text-green-400" />
                <Linea k="Sin atender" v={`${reporte.totalSinAtender.toLocaleString()} (${reporte.porcentajeSinAtender}%)`} clr="text-red-400" />
                {reporte.epocaColapso != null && <Linea k="Colapsó en época" v={reporte.epocaColapso} />}
                {reporte.aeropuertosSaturados?.length > 0 && (
                  <Linea k="Aeropuertos saturados" v={reporte.aeropuertosSaturados.join(', ')} clr="text-red-400" />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Avance + almacenes */}
        <div className="lg:col-span-2 space-y-6">
          <div className={`rounded-2xl border p-5 ${estado === 'colapso' ? 'bg-red-500/10 border-red-500/40' : 'bg-slate-800 border-slate-700'}`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Avance</h2>
              <span className={`text-xs font-medium ${
                estado === 'corriendo' ? 'text-blue-400' : estado === 'colapso' ? 'text-red-400' : estado === 'fin' ? 'text-green-400' : estado === 'error' ? 'text-red-400' : 'text-slate-500'}`}>
                {estado === 'corriendo' ? '● cargando…' : estado === 'colapso' ? '⚠ COLAPSO' : estado === 'fin' ? '✓ finalizada' : estado === 'error' ? '✕ error' : 'lista'}
              </span>
            </div>

            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-3xl font-bold font-mono text-white">
                {evento?.relojSimulado ? String(evento.relojSimulado).replace('T', ' ').slice(0, 16) : '—'}
              </span>
              <span className="text-xs text-slate-500">reloj simulado · época {evento?.numeroEpoca ?? 0}/{evento?.totalEpocas ?? '—'}</span>
            </div>

            {evento && (
              <div className="grid grid-cols-3 gap-3">
                <Metric label="Despachados (época)" value={evento.enviosDespachados} clr="text-green-400" />
                <Metric label="Pendientes" value={evento.enviosPostpuestos} clr="text-amber-400" />
                <Metric label="Asignados (total)" value={evento.totalAsignadosAcumulado} clr="text-blue-400" />
              </div>
            )}
            {mensaje && <p className="mt-3 text-xs text-slate-400">{mensaje}</p>}
          </div>

          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Ocupación de almacenes</h2>
            {almacenes.length === 0 ? (
              <p className="text-sm text-slate-500">Sin datos todavía. Inicia el colapso.</p>
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

function Linea({ k, v, clr = 'text-slate-200' }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-400">{k}</span>
      <span className={`font-mono ${clr}`}>{v}</span>
    </div>
  )
}
