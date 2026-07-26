import { useState, useEffect, useCallback } from 'react'
import NavBar from '../components/NavBar'
import {
  getAirports,
  registrarEnvioDiario,
  getEstadoDiario,
  reiniciarDiario,
  cerrarOperacionDiaria,
  getReporteCierreDiario,
} from '../services/api'

// Operación día a día (escenario REAL_TIME).
// Pantalla independiente del simulador: se registran envíos a mano, uno a uno,
// y las capacidades de los vuelos se van llenando en vivo hasta el colapso.
// No corre el optimizador ni replanifica — solo valida que exista ruta con cupo.

function colorOcupacion(pct) {
  if (pct >= 90) return { txt: 'text-red-400', bar: 'bg-red-500', bg: 'bg-red-500/10 border-red-500/30' }
  if (pct >= 70) return { txt: 'text-amber-400', bar: 'bg-amber-500', bg: 'bg-amber-500/10 border-amber-500/30' }
  return { txt: 'text-green-400', bar: 'bg-green-500', bg: 'bg-green-500/10 border-green-500/30' }
}

export default function OperacionDiaria() {
  const [aeropuertos, setAeropuertos] = useState([])
  const [estado, setEstado] = useState(null)
  const [cargandoEstado, setCargandoEstado] = useState(true)

  const [origen, setOrigen] = useState('')
  const [destino, setDestino] = useState('')
  const [maletas, setMaletas] = useState('')
  const [cliente, setCliente] = useState('')
  const [enviando, setEnviando] = useState(false)

  // Historial de registros de esta sesión (lo último arriba).
  const [registros, setRegistros] = useState([])
  const [error, setError] = useState(null)

  // G09: reporte de cierre de la jornada. Mientras sea null la jornada está
  // abierta; en cuanto existe, la operación queda congelada y se muestra el
  // reporte de la última planificación estable.
  const [cierre, setCierre] = useState(null)
  const [cerrando, setCerrando] = useState(false)

  const refrescarEstado = useCallback(async () => {
    try {
      const s = await getEstadoDiario()
      setEstado(s)
    } catch {
      setError('No se pudo obtener el estado. ¿El backend está corriendo y hay datos cargados?')
    } finally {
      setCargandoEstado(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    getAirports(0, 500)
      .then(page => { if (alive) setAeropuertos(page?.content ?? []) })
      .catch(() => {})
    refrescarEstado()
    // G09: si la jornada ya fue cerrada (p. ej. desde otro visualizador),
    // recuperamos el reporte al entrar en vez de mostrar la pantalla operativa.
    getReporteCierreDiario()
      .then(r => { if (alive && r) setCierre(r) })
      .catch(() => {})
    return () => { alive = false }
  }, [refrescarEstado])

  async function handleCerrar() {
    setError(null)
    setCerrando(true)
    try {
      const reporte = await cerrarOperacionDiaria()
      setCierre(reporte)
      await refrescarEstado()
    } catch {
      setError('No se pudo cerrar la jornada.')
    } finally {
      setCerrando(false)
    }
  }

  async function handleRegistrar(e) {
    e.preventDefault()
    setError(null)
    const cant = parseInt(maletas, 10)
    if (!origen || !destino) { setError('Selecciona origen y destino.'); return }
    if (origen === destino) { setError('El origen y el destino no pueden ser iguales.'); return }
    if (!Number.isFinite(cant) || cant <= 0) { setError('La cantidad de maletas debe ser mayor que cero.'); return }

    setEnviando(true)
    try {
      const res = await registrarEnvioDiario({
        origenIcao: origen,
        destinoIcao: destino,
        cantidadMaletas: cant,
        idCliente: cliente || null,
      })
      setRegistros(prev => [{ ...res, ts: new Date() }, ...prev].slice(0, 50))
      if (res.aceptado) {
        setMaletas('')
      }
      await refrescarEstado()
    } catch {
      setError('No se pudo conectar con el servidor.')
    } finally {
      setEnviando(false)
    }
  }

  async function handleReset() {
    setError(null)
    try {
      const s = await reiniciarDiario()
      setEstado(s)
      setRegistros([])
      setCierre(null) // G09: reiniciar abre una jornada nueva.
    } catch {
      setError('No se pudo reiniciar.')
    }
  }

  const colapso = estado?.colapsoTotal
  const ocupFlota = estado?.ocupacionFlotaPorcentaje ?? 0
  const colFlota = colorOcupacion(ocupFlota)

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200">
      <NavBar />

      <div className="max-w-6xl mx-auto px-6 pt-4 flex items-center justify-between print:hidden">
        <span className="text-xs text-slate-400 uppercase tracking-widest">
          Operación Día a Día — Tiempo Real
          {cierre && <span className="ml-2 text-amber-400">· JORNADA CERRADA</span>}
        </span>
        <div className="flex gap-2">
          {/* G09: cerrar congela la jornada y emite el reporte de la última
              planificación estable. Solo tiene sentido con la jornada abierta. */}
          {!cierre && (
            <button
              onClick={handleCerrar}
              disabled={cerrando}
              className="px-3 py-1.5 rounded text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 disabled:cursor-not-allowed text-white transition-colors"
            >
              {cerrando ? 'Cerrando…' : 'Cerrar operaciones del día'}
            </button>
          )}
          <button
            onClick={handleReset}
            className="px-3 py-1.5 rounded text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-700 border border-slate-700 transition-colors"
          >
            {cierre ? 'Abrir jornada nueva' : 'Reiniciar operación'}
          </button>
        </div>
      </div>

      {/* G09: con la jornada cerrada, la pantalla pasa a ser el reporte. */}
      {cierre && <ReporteCierre reporte={cierre} />}

      <div className={`max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 ${cierre ? 'hidden' : ''}`}>

        {/* Columna izquierda: formulario + resumen */}
        <div className="space-y-6">

          {/* Resumen / semáforo de colapso */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Estado de la operación</h2>
            <div className={`rounded-xl border p-4 mb-4 ${colapso ? 'bg-red-500/10 border-red-500/40' : colFlota.bg}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Ocupación de la flota</span>
                <span className={`text-2xl font-bold font-mono ${colapso ? 'text-red-400' : colFlota.txt}`}>
                  {ocupFlota.toFixed(1)}%
                </span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-slate-700 overflow-hidden">
                <div className={`h-full ${colapso ? 'bg-red-500' : colFlota.bar} transition-all duration-500`}
                     style={{ width: `${Math.min(100, ocupFlota)}%` }} />
              </div>
              {colapso && (
                <p className="mt-3 text-sm text-red-400 font-semibold flex items-center gap-2">
                  ⚠ COLAPSO TOTAL — ningún vuelo admite más carga.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Metric label="Registrados" value={estado?.totalRegistrados ?? 0} clr="text-slate-200" />
              <Metric label="Aceptados" value={estado?.totalAceptados ?? 0} clr="text-green-400" />
              <Metric label="Rechazados" value={estado?.totalRechazados ?? 0} clr="text-red-400" />
              <Metric label="Maletas" value={estado?.totalMaletasDespachadas ?? 0} clr="text-blue-400" />
            </div>
          </div>

          {/* Formulario de registro */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Registrar envío</h2>
            <form onSubmit={handleRegistrar} className="space-y-3">
              <SelectAeropuerto label="Origen" value={origen} onChange={setOrigen} aeropuertos={aeropuertos} />
              <SelectAeropuerto label="Destino" value={destino} onChange={setDestino} aeropuertos={aeropuertos} />
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Cantidad de maletas</label>
                <input
                  type="number" min="1" value={maletas}
                  onChange={e => setMaletas(e.target.value)}
                  placeholder="Ej. 50"
                  className="w-full px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Aerolínea / cliente (opcional)</label>
                <input
                  type="text" value={cliente}
                  onChange={e => setCliente(e.target.value)}
                  placeholder="Ej. LATAM"
                  className="w-full px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                type="submit" disabled={enviando}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {enviando
                  ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Registrando…</>
                  : 'Registrar envío'}
              </button>
            </form>
          </div>
        </div>

        {/* Columna derecha (2 cols): historial + capacidades */}
        <div className="lg:col-span-2 space-y-6">

          {/* Historial de registros de la sesión */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Registros de la sesión</h2>
            {registros.length === 0 ? (
              <p className="text-sm text-slate-500">Aún no se ha registrado ningún envío.</p>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-y-auto">
                {registros.map((r, i) => (
                  <li key={i} className={`rounded-lg border px-3 py-2 text-sm flex items-center justify-between gap-3 ${
                    r.aceptado ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                    <div className="min-w-0">
                      <span className={`font-mono font-medium ${r.aceptado ? 'text-green-400' : 'text-red-400'}`}>
                        {r.aceptado ? '✓' : '✕'} {r.origenIcao} → {r.destinoIcao}
                      </span>
                      <span className="text-slate-400 ml-2">{r.cantidadMaletas} maletas</span>
                      {r.aceptado && (
                        <span className="text-slate-500 ml-2 text-xs">
                          {r.directa ? 'directa' : `${r.escalas} escala(s)`} · {r.rutaVuelos?.join(' → ')}
                        </span>
                      )}
                      {!r.aceptado && <span className="block text-xs text-red-300/70 truncate">{r.mensaje}</span>}
                    </div>
                    {r.envioId && <span className="shrink-0 text-xs font-mono text-slate-500">{r.envioId}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Capacidades de vuelos */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Capacidad de vuelos (en vivo)</h2>
              <span className="text-xs text-slate-500">{estado?.vuelos?.length ?? 0} vuelos</span>
            </div>
            {cargandoEstado ? (
              <p className="text-sm text-slate-500">Cargando…</p>
            ) : (
              <div className="rounded-xl overflow-hidden border border-slate-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-700/50 text-slate-300">
                      <th className="text-left px-3 py-2 font-semibold">Vuelo</th>
                      <th className="text-left px-3 py-2 font-semibold">Ruta</th>
                      <th className="text-right px-3 py-2 font-semibold">Ocupado</th>
                      <th className="px-3 py-2 font-semibold w-40">Ocupación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(estado?.vuelos ?? []).map((v, i) => {
                      const c = colorOcupacion(v.ocupacionPorcentaje)
                      return (
                        <tr key={v.vueloId} className={i % 2 === 0 ? 'bg-slate-800/50' : 'bg-slate-900/30'}>
                          <td className="px-3 py-2 font-mono text-xs text-slate-400">{v.vueloId}</td>
                          <td className="px-3 py-2 text-slate-300">{v.origenIcao} → {v.destinoIcao}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-400">{v.ocupado}/{v.capacidad}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                                <div className={`h-full ${c.bar}`} style={{ width: `${Math.min(100, v.ocupacionPorcentaje)}%` }} />
                              </div>
                              <span className={`text-xs font-mono w-12 text-right ${c.txt}`}>{v.ocupacionPorcentaje.toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
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
      <div className={`text-xl font-bold font-mono leading-none ${clr}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  )
}

// G09: reporte de la última planificación estable al cerrar las operaciones
// día a día. Mismo formato que el reporte de periodo (imprimible) para que los
// tres escenarios se presenten de forma consistente.
function fmtFecha(dt) {
  if (!dt) return '—'
  return String(dt).replace('T', ' ').slice(0, 19)
}

function ReporteCierre({ reporte }) {
  const atencion = reporte.porcentajeAtencion ?? 0
  const colorAtencion = atencion >= 95 ? 'text-green-400' : atencion >= 85 ? 'text-amber-400' : 'text-red-400'
  const atendidos = reporte.enviosAtendidos ?? []
  const rechazados = reporte.enviosRechazados ?? []

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-5 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-white">Reporte de Cierre — Operación Día a Día</h1>
          <p className="text-slate-400 text-sm">Última planificación estable de la jornada</p>
        </div>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
        >
          🖨 Imprimir / PDF
        </button>
      </div>

      <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden print:bg-white">
        {/* Desenlace de la jornada */}
        <div className={`px-6 py-4 border-b border-slate-700 ${
          reporte.colapsoTotal ? 'bg-red-500/10' : ''
        }`}>
          <div className="text-xs text-slate-400 uppercase tracking-widest mb-1">Cierre de jornada</div>
          <div className={`text-sm font-medium ${reporte.colapsoTotal ? 'text-red-400' : 'text-slate-200'}`}>
            {reporte.colapsoTotal ? '⚠ ' : ''}{reporte.motivo}
          </div>
        </div>

        {/* Cumplimiento destacado */}
        <div className="px-6 py-6 border-b border-slate-700 text-center">
          <div className="text-xs text-slate-400 uppercase tracking-widest mb-1">Envíos atendidos</div>
          <div className={`text-5xl font-bold ${colorAtencion}`}>{atencion}%</div>
          <div className="text-xs text-slate-500 mt-1">
            {reporte.totalAceptados} de {reporte.totalRegistrados} envíos registrados
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-slate-700">
          <KpiCierre label="Atendidos" value={reporte.totalAceptados} clr="text-green-400" />
          <KpiCierre label="Rechazados" value={reporte.totalRechazados} clr="text-red-400" />
          <KpiCierre label="Maletas despachadas" value={reporte.totalMaletasDespachadas} clr="text-blue-400" />
          <KpiCierre label="Ocupación de flota" value={`${reporte.ocupacionFlotaPorcentaje}%`} clr="text-white" raw />
          <KpiCierre label="Vuelos saturados" value={`${reporte.vuelosSaturados}/${reporte.vuelosOperados}`} clr="text-amber-400" raw />
          <KpiCierre label="Registrados" value={reporte.totalRegistrados} clr="text-slate-300" />
        </div>

        {/* Tiempos */}
        <div className="px-6 py-4 border-t border-slate-700 text-sm space-y-1">
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Inicio de operación</span>
            <span className="text-slate-200 font-mono">{fmtFecha(reporte.inicioOperacion)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Cierre</span>
            <span className="text-slate-200 font-mono">{fmtFecha(reporte.fechaCierre)}</span>
          </div>
        </div>

        {/* Detalle de envíos atendidos */}
        <div className="px-6 py-4 border-t border-slate-700">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Envíos atendidos ({atendidos.length})
          </h3>
          {atendidos.length === 0 ? (
            <p className="text-sm text-slate-500">Ninguno.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto print:max-h-none print:overflow-visible">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 text-xs">
                    <th className="text-left py-1.5 font-semibold">Envío</th>
                    <th className="text-left py-1.5 font-semibold">Ruta</th>
                    <th className="text-right py-1.5 font-semibold">Maletas</th>
                    <th className="text-left py-1.5 font-semibold pl-3">Plan de vuelos</th>
                  </tr>
                </thead>
                <tbody>
                  {atendidos.map(e => (
                    <tr key={e.envioId} className="border-t border-slate-700/50">
                      <td className="py-1.5 font-mono text-xs text-slate-400">{e.envioId}</td>
                      <td className="py-1.5 text-slate-300">{e.origenIcao} → {e.destinoIcao}</td>
                      <td className="py-1.5 text-right font-mono text-slate-400">{e.cantidadMaletas}</td>
                      <td className="py-1.5 pl-3 text-xs text-slate-500">
                        {e.directa ? 'directa' : `${e.escalas} escala(s)`} · {(e.rutaVuelos ?? []).join(' → ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detalle de rechazos */}
        {rechazados.length > 0 && (
          <div className="px-6 py-4 border-t border-slate-700">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Envíos no atendidos ({rechazados.length})
            </h3>
            <ul className="space-y-1.5 max-h-60 overflow-y-auto print:max-h-none print:overflow-visible">
              {rechazados.map((r, i) => (
                <li key={i} className="text-sm flex justify-between gap-3 border-t border-slate-700/50 pt-1.5">
                  <span className="font-mono text-red-400 shrink-0">
                    {r.origenIcao} → {r.destinoIcao} ({r.cantidadMaletas})
                  </span>
                  <span className="text-xs text-slate-500 text-right">{r.motivo}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Vuelos más cargados al cierre */}
        {(reporte.vuelosMasCargados ?? []).length > 0 && (
          <div className="px-6 py-4 border-t border-slate-700">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Vuelos más cargados al cierre
            </h3>
            <div className="space-y-1.5">
              {reporte.vuelosMasCargados.map(v => {
                const c = colorOcupacion(v.ocupacionPorcentaje)
                return (
                  <div key={v.vueloId} className="flex items-center gap-2 text-xs">
                    <span className="text-slate-300 w-28 shrink-0">{v.origenIcao} → {v.destinoIcao}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                      <div className={`h-full ${c.bar}`} style={{ width: `${Math.min(100, v.ocupacionPorcentaje)}%` }} />
                    </div>
                    <span className={`font-mono w-20 text-right ${c.txt}`}>
                      {v.ocupado}/{v.capacidad}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function KpiCierre({ label, value, clr, raw = false }) {
  return (
    <div className="bg-slate-800 px-4 py-4 text-center print:bg-white">
      <div className={`text-2xl font-bold font-mono ${clr}`}>
        {raw ? value : Number(value ?? 0).toLocaleString()}
      </div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  )
}

function SelectAeropuerto({ label, value, onChange, aeropuertos }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
      >
        <option value="">— Selecciona —</option>
        {aeropuertos.map(a => (
          <option key={a.codigoIcao} value={a.codigoIcao}>
            {a.codigoIcao} — {a.ciudad}, {a.pais}
          </option>
        ))}
      </select>
    </div>
  )
}
