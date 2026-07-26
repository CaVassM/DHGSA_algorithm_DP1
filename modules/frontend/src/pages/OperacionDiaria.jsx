import { useState, useEffect, useCallback } from 'react'
import NavBar from '../components/NavBar'
import { getAirports, registrarEnvioDiario, getEstadoDiario, reiniciarDiario } from '../services/api'

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
    return () => { alive = false }
  }, [refrescarEstado])

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

      <div className="max-w-6xl mx-auto px-6 pt-4 flex items-center justify-between">
        <span className="text-xs text-slate-400 uppercase tracking-widest">Operación Día a Día — Tiempo Real</span>
        <button
          onClick={handleReset}
          className="px-3 py-1.5 rounded text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-700 border border-slate-700 transition-colors"
        >
          Reiniciar operación
        </button>
      </div>

      <div className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">

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
