import { useState, useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { AEROPUERTOS, getOcupacionPct, getSemaforoPorOcupacion } from '../data/aeropuertos'
import { getOcupacionVueloPct, VUELOS_EN_AIRE } from '../data/vuelos'
import { KPIS, DATOS_GRAFICO_DIAS, CONTINENTES } from '../data/simulacion'
import NavBar from '../components/NavBar'
import SemaforoBadge from '../components/SemaforoBadge'
import BarraProgreso from '../components/BarraProgreso'
import { getPlanningRun, getAirports, getFlights, getPlanningRunRoutes } from '../services/api'

const LS_KEY = 'tasf_runId'

const SEMAFORO_LABEL = {
  vacio: { label: 'VACÍO (0)',     color: 'vacio' },
  verde: { label: '<60% ÓPTIMO',   color: 'verde' },
  ambar: { label: '60-85% RIESGO', color: 'ambar' },
  rojo:  { label: '>85% CRÍTICO',  color: 'rojo'  },
}

const SEMAFORO_FLOTA_LABEL = {
  vacio: '0% VACÍO',
  verde: '<70% ÓPTIMO',
  ambar: '70-90% RIESGO',
  rojo:  '>90% CRÍTICO',
}

function getSemaforoFlota(pct) {
  if (pct === 0)   return 'vacio'
  if (pct < 70)    return 'verde'
  if (pct <= 90)   return 'ambar'
  return 'rojo'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Adaptar AirportResponse[] al formato mínimo que necesita el ranking
function adaptAirports(content) {
  return (content ?? []).map(ap => ({
    codigo:     ap.codigoIcao,
    continente: ap.continente ?? ap.pais,
    almacen:    { actual: 0, capacidad: ap.capacidadAlmacen || 1 },
  }))
}

// Agrupar RouteResponse[] por par origen-destino y calcular maletas totales.
// Se usa maxActual como "capacidad" para mostrar utilización relativa entre rutas.
function adaptRoutes(routeList) {
  const groups = new Map()
  for (const r of routeList) {
    const key = `${r.origenIcao}→${r.destinoIcao}`
    const g = groups.get(key)
    if (g) {
      g.actual += r.cantidadMaletas ?? 0
    } else {
      groups.set(key, {
        codigo: key,
        desde:  r.origenIcao,
        hasta:  r.destinoIcao,
        actual: r.cantidadMaletas ?? 0,
        estado: r.esDirecta ? 'DIRECTO' : 'ESCALAS',
        tiempo: r.esDirecta ? 'Vuelo directo' : `${r.escalas} escala(s)`,
      })
    }
  }
  const maxActual = Math.max(...Array.from(groups.values()).map(g => g.actual), 1)
  return Array.from(groups.values())
    .map(g => ({ ...g, capacidad: maxActual }))
    .sort((a, b) => b.actual - a.actual)
}

// Normaliza un horario (LocalTime "HH:mm:ss" del backend, o "10:30 AM" del mock) a "HH:mm".
function formatHorario(h) {
  if (!h) return '—'
  const s = String(h)
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return s
  const hh = m[1].padStart(2, '0')
  const suffix = /am|pm/i.test(s) ? ` ${s.match(/am|pm/i)[0].toUpperCase()}` : ''
  return `${hh}:${m[2]}${suffix}`
}

// Construye la lista de UT individuales (Unidades de Transporte = vuelos).
// El stock/ocupación de cada UT = suma de maletas de las rutas que la usan.
function buildUTs(flightList, routeList) {
  const maletasPorVuelo = new Map()
  ;(routeList ?? []).forEach(r => {
    ;(r.flightBusinessIds ?? []).forEach(fid => {
      maletasPorVuelo.set(fid, (maletasPorVuelo.get(fid) ?? 0) + (r.cantidadMaletas ?? 0))
    })
  })
  return (flightList ?? [])
    .filter(Boolean)
    .map((f, i) => {
      const codigo    = String(f.businessId ?? f.id ?? `UT-${i + 1}`)
      const actual    = maletasPorVuelo.get(f.businessId) ?? 0
      const capacidad = f.capacidad || 0
      return {
        codigo,
        desde:     f.origenIcao ?? '—',
        hasta:     f.destinoIcao ?? '—',
        horario:   f.horaSalida,
        actual,
        capacidad,
        pct: capacidad > 0 ? Math.round((actual / capacidad) * 100) : 0,
      }
    })
    .sort((a, b) => b.pct - a.pct || a.codigo.localeCompare(b.codigo))
}

// Lista de UT a partir de los datos mock (cada vuelo en aire ya es una UT individual).
function buildUTsMock() {
  return VUELOS_EN_AIRE
    .map(v => {
      const capacidad = v.maletasCapacidad || 0
      return {
        codigo:    v.codigo,
        desde:     v.desde,
        hasta:     v.hasta,
        horario:   v.horaDespegue,
        actual:    v.maletasActual,
        capacidad,
        pct: capacidad > 0 ? Math.round((v.maletasActual / capacidad) * 100) : 0,
      }
    })
    .sort((a, b) => b.pct - a.pct || a.codigo.localeCompare(b.codigo))
}

// Color del semáforo de ocupación de una UT (reutiliza el estado VACÍO para 0 maletas).
function colorOcupacionUT(ut) {
  if (ut.capacidad === 0) return 'azul'
  if (ut.actual === 0)    return 'vacio'
  if (ut.pct >= 90)       return 'rojo'
  if (ut.pct >= 50)       return 'ambar'
  return 'verde'
}

// Agrupar AirportResponse[] por continente; sumar maletas de rutas cuyo origen esté en ese continente
function buildContinentes(airportList, routeList) {
  const codeToContinent = {}
  const byContinent     = {}

  airportList.forEach(ap => {
    const cont = ap.continente ?? ap.pais ?? 'Otros'
    codeToContinent[ap.codigoIcao] = cont
    if (!byContinent[cont]) byContinent[cont] = { nombre: cont, codigos: [], maletas: 0 }
    byContinent[cont].codigos.push(ap.codigoIcao)
  })

  ;(routeList ?? []).forEach(r => {
    const cont = codeToContinent[r.origenIcao]
    if (cont && byContinent[cont]) byContinent[cont].maletas += r.cantidadMaletas ?? 0
  })

  return Object.values(byContinent)
    .sort((a, b) => b.maletas - a.maletas || a.nombre.localeCompare(b.nombre))
}

function continentEmoji(nombre) {
  const n = (nombre ?? '').toLowerCase()
  if (n.includes('amér') || n.includes('amer') || n.includes('carib')) return '🌎'
  if (n.includes('europ') || n.includes('afric')) return '🌍'
  return '🌏'
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold text-white mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {p.value.toLocaleString()}
        </p>
      ))}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function IndicadoresGlobales() {
  const location = useLocation()
  const stored   = localStorage.getItem(LS_KEY)
  const runId    = location.state?.runId ?? (stored ? Number(stored) : null)

  const [run,      setRun]      = useState(null)
  const [airports, setAirports] = useState(null)
  const [routes,   setRoutes]   = useState(null)
  const [flights,  setFlights]  = useState(null)
  const [sortDir,          setSortDir]          = useState('desc')
  const [filtroTexto,      setFiltroTexto]      = useState('')
  const [filtroContinente, setFiltroContinente] = useState('Todos')

  useEffect(() => {
    if (!runId) return
    getPlanningRun(runId).then(setRun).catch(() => {})
  }, [runId])

  useEffect(() => {
    getAirports()
      .then(page => { if (page.content?.length > 0) setAirports(page.content) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    getFlights()
      .then(page => { if (page.content?.length > 0) setFlights(page.content) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!runId) return
    getPlanningRunRoutes(runId)
      .then(list => { if (list.length > 0) setRoutes(list) })
      .catch(() => {})
  }, [runId])

  // ── Métricas globales ────────────────────────────────────────────────────
  const totalAsignados   = run?.totalEnviosAsignados   ?? null
  const totalPendientes  = run?.totalEnviosNoAsignados  ?? null
  const totalDespachadas = run?.totalMaletasDespachadas ?? null

  const totalEnvios     = (totalAsignados ?? 0) + (totalPendientes ?? 0)
  const cumplimientoPct = run
    ? (totalEnvios > 0 ? Math.round(totalAsignados / totalEnvios * 1000) / 10 : 0)
    : KPIS.cumplimientoPlazos
  const cumplimientoColor = cumplimientoPct >= 95 ? 'verde' : cumplimientoPct >= 85 ? 'ambar' : 'rojo'

  // ── Tabla de rutas — sin fallback a datos mock ───────────────────────────
  const vuelosData  = routes ? adaptRoutes(routes) : []

  // ── Lista de UT individuales (Unidades de Transporte) ────────────────────
  // Con vuelos reales se enumera cada UT y se le imputa el stock de las rutas;
  // sin datos reales se usan los vuelos mock (cada uno ya es una UT individual).
  const utsData      = flights ? buildUTs(flights, routes ?? []) : buildUTsMock()
  const utsReales    = !!flights
  const utsOcupadas  = utsData.filter(u => u.actual > 0).length
  const utsVacias    = utsData.filter(u => u.actual === 0).length

  const vuelosActivos = vuelosData.length
  const vuelosAltos   = vuelosData.filter(v => getOcupacionVueloPct(v) >= 90).length
  const vuelosBajos   = vuelosData.filter(v => getOcupacionVueloPct(v) < 50).length
  const promGlobal    = vuelosData.length > 0
    ? Math.round(vuelosData.reduce((acc, v) => acc + getOcupacionVueloPct(v), 0) / vuelosData.length * 10) / 10
    : 0
  const colorFlota  = getSemaforoFlota(promGlobal)

  // ── Continentes ──────────────────────────────────────────────────────────
  // Cuando hay aeropuertos reales, se agrupan por continente con rutas reales.
  // De lo contrario se usan los datos mock de simulacion.js.
  const continentesReales = airports ? buildContinentes(airports, routes ?? []) : null

  // ── Ranking de aeropuertos ───────────────────────────────────────────────
  const continentesUnicos = useMemo(() => {
    const base = airports ? adaptAirports(airports) : Object.values(AEROPUERTOS)
    return [...new Set(base.map(ap => ap.continente))].sort()
  }, [airports])

  const promAlmacenes = useMemo(() => {
    const base = airports ? adaptAirports(airports) : Object.values(AEROPUERTOS)
    const pcts = base.map(ap => getOcupacionPct(ap))
    return pcts.length > 0
      ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length * 10) / 10
      : 0
  }, [airports])

  const rankingAeropuertos = useMemo(() => {
    const cmp = sortDir === 'desc'
      ? (a, b) => b.pct - a.pct || a.codigo.localeCompare(b.codigo)
      : (a, b) => a.pct - b.pct || a.codigo.localeCompare(b.codigo)
    const base = airports
      ? adaptAirports(airports)
      : Object.values(AEROPUERTOS)
    return base
      .map(ap => ({ ...ap, pct: getOcupacionPct(ap), color: getSemaforoPorOcupacion(getOcupacionPct(ap)) }))
      .filter(ap => ap.codigo.toLowerCase().includes(filtroTexto.toLowerCase()))
      .filter(ap => filtroContinente === 'Todos' || ap.continente === filtroContinente)
      .sort(cmp)
  }, [airports, sortDir, filtroTexto, filtroContinente])

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col">
      <NavBar />
      <div className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">

        {/* Fila superior: Cumplimiento + Gráfico */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Cumplimiento global */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 flex flex-col justify-between">
            <div>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Cumplimiento Global</h2>
              <div className={`text-5xl font-bold mb-2 ${cumplimientoColor === 'verde' ? 'text-green-400' : cumplimientoColor === 'ambar' ? 'text-amber-400' : 'text-red-400'}`}>
                {cumplimientoPct}%
              </div>
              <p className="text-slate-400 text-sm mb-4">
                {run ? 'de envíos asignados correctamente' : 'de maletas entregadas en plazo'}
              </p>
            </div>
            <div>
              <BarraProgreso pct={cumplimientoPct} color={cumplimientoColor} height="h-3" showLabel />
              <div className="mt-3 grid grid-cols-3 text-center text-xs">
                <div>
                  <div className="text-green-400 font-mono font-bold">
                    {(run ? totalAsignados : KPIS.maletasEntregadas)?.toLocaleString() ?? '—'}
                  </div>
                  <div className="text-slate-500">{run ? 'Asignados' : 'Entregadas'}</div>
                </div>
                <div>
                  <div className="text-amber-400 font-mono font-bold">
                    {(run ? totalPendientes : KPIS.maletasPendientes)?.toLocaleString() ?? '—'}
                  </div>
                  <div className="text-slate-500">Pendientes</div>
                </div>
                <div>
                  <div className="text-blue-400 font-mono font-bold">
                    {(run ? totalDespachadas : KPIS.maletasTransito)?.toLocaleString() ?? '—'}
                  </div>
                  <div className="text-slate-500">{run ? 'Despachadas' : 'En tránsito'}</div>
                </div>
              </div>
              {run?.costoTotal != null && (
                <div className="mt-3 pt-3 border-t border-slate-700 flex justify-between text-xs">
                  <span className="text-slate-400">Costo total</span>
                  <span className="font-mono font-bold text-white">
                    {run.costoTotal.toLocaleString('es', { maximumFractionDigits: 1 })}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Gráfico días — siempre mock (el backend no expone datos por época en este endpoint) */}
          <div className="lg:col-span-2 bg-slate-800 rounded-xl border border-slate-700 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
              Maletas Procesadas por Día vs Capacidad
            </h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={DATOS_GRAFICO_DIAS} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="dia" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: '#94a3b8' }}
                  formatter={(value) => <span style={{ color: '#94a3b8' }}>{value}</span>}
                />
                <Bar dataKey="procesadas" name="Procesadas" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="capacidad" name="Capacidad disponible" fill="#475569" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-slate-500 text-xs mt-2 text-right">Utilización promedio: 78.3%</p>
          </div>
        </div>

        {/* Utilización de vuelos / rutas */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700">
            <h2 className="font-semibold text-white">Utilización de Capacidad de Vuelos</h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-700">

            <div className="p-5">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 text-sm">Promedio global</span>
                  <div className="flex items-center gap-2">
                    <SemaforoBadge color={colorFlota} label={SEMAFORO_FLOTA_LABEL[colorFlota]} />
                    <span className="font-mono font-bold text-lg text-blue-400">{promGlobal}%</span>
                  </div>
                </div>
                <MetricaVuelo label="Vuelos activos"  value={vuelosActivos}    color="text-white" />
                <MetricaVuelo label="Vuelos >90%"     value={vuelosAltos}      color="text-red-400" />
                <MetricaVuelo label="Vuelos <50%"     value={vuelosBajos}      color="text-blue-400" />
              </div>
            </div>

            <div className="lg:col-span-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700/40 text-slate-400 text-xs uppercase">
                    <th className="text-left px-4 py-3">Origen</th>
                    <th className="text-left px-4 py-3">Ruta</th>
                    <th className="text-right px-4 py-3">Maletas</th>
                    <th className="px-4 py-3 w-32"></th>
                    <th className="text-left px-4 py-3">Tipo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {vuelosData.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-slate-500 text-sm">
                        {runId ? 'Cargando rutas...' : 'Inicia una simulación para ver las rutas planificadas'}
                      </td>
                    </tr>
                  ) : (
                    vuelosData.map((v) => {
                      const pct      = getOcupacionVueloPct(v)
                      const barColor = pct >= 90 ? 'rojo' : pct >= 50 ? 'ambar' : 'verde'
                      return (
                        <tr key={v.codigo} className="hover:bg-slate-700/20 transition-colors">
                          <td className="px-4 py-3 font-mono font-semibold text-blue-400 text-xs">{v.desde}</td>
                          <td className="px-4 py-3 text-slate-300">{v.desde} → {v.hasta}</td>
                          <td className="px-4 py-3 font-mono text-slate-300 text-right">{v.actual.toLocaleString()}</td>
                          <td className="px-4 py-3">
                            <BarraProgreso pct={pct} color={barColor} height="h-1.5" showLabel />
                          </td>
                          <td className="px-4 py-3 text-slate-400 text-xs">{v.tiempo}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Lista de UT individuales (Unidades de Transporte) */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-semibold text-white">Unidades de Transporte (UT)</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {utsReales
                  ? 'Cada vuelo individual con su ocupación/stock'
                  : 'Cada vuelo individual con su ocupación/stock — datos de demostración'}
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-slate-400">Total: <span className="font-mono font-bold text-white">{utsData.length}</span></span>
              <span className="text-slate-400">Con carga: <span className="font-mono font-bold text-green-400">{utsOcupadas}</span></span>
              <span className="text-slate-400">Vacías: <span className="font-mono font-bold text-slate-300">{utsVacias}</span></span>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-700 text-slate-400 text-xs uppercase">
                  <th className="text-left px-4 py-3">UT (código)</th>
                  <th className="text-left px-4 py-3">Origen → Destino</th>
                  <th className="text-left px-4 py-3">Horario</th>
                  <th className="text-right px-4 py-3">Stock</th>
                  <th className="text-left px-4 py-3 w-44">Ocupación</th>
                  <th className="text-left px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {utsData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500 text-sm">
                      {runId ? 'Cargando unidades de transporte...' : 'No hay unidades de transporte para mostrar'}
                    </td>
                  </tr>
                ) : (
                  utsData.map((ut) => {
                    const color = colorOcupacionUT(ut)
                    return (
                      <tr key={ut.codigo} className="hover:bg-slate-700/20 transition-colors">
                        <td className="px-4 py-3 font-mono font-semibold text-blue-400 text-xs">{ut.codigo}</td>
                        <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{ut.desde} → {ut.hasta}</td>
                        <td className="px-4 py-3 text-slate-400 font-mono text-xs whitespace-nowrap">{formatHorario(ut.horario)}</td>
                        <td className="px-4 py-3 font-mono text-slate-300 text-right whitespace-nowrap">
                          {ut.actual.toLocaleString()}/{ut.capacidad.toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <BarraProgreso pct={ut.pct} color={color} height="h-1.5" showLabel />
                        </td>
                        <td className="px-4 py-3">
                          <SemaforoBadge
                            color={color}
                            label={ut.actual === 0 ? 'VACÍA' : ut.pct >= 90 ? 'LLENA' : ut.pct >= 50 ? 'ALTA' : 'BAJA'}
                          />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Resumen por continente */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {continentesReales
            ? continentesReales.map(c => (
                <div key={c.nombre} className="bg-slate-800 rounded-xl border border-slate-700 p-5">
                  <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
                    <span className="text-lg">{continentEmoji(c.nombre)}</span>
                    {c.nombre}
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Maletas procesadas</span>
                      <span className="font-mono font-semibold text-white">{c.maletas.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Aeropuertos</span>
                      <span className="font-mono font-semibold text-blue-400">{c.codigos.length}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-xs">Códigos: </span>
                      <span className="text-slate-300 text-xs font-mono">
                        {c.codigos.slice(0, 6).join(', ')}{c.codigos.length > 6 ? '…' : ''}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            : CONTINENTES.map(c => {
                const cumColor = c.cumplimiento >= 95 ? 'verde' : c.cumplimiento >= 85 ? 'ambar' : 'rojo'
                const cumText  = { verde: 'text-green-400', ambar: 'text-amber-400', rojo: 'text-red-400' }[cumColor]
                return (
                  <div key={c.nombre} className="bg-slate-800 rounded-xl border border-slate-700 p-5">
                    <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
                      <span className="text-lg">{c.nombre === 'América' ? '🌎' : c.nombre === 'Europa' ? '🌍' : '🌏'}</span>
                      {c.nombre}
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Maletas procesadas</span>
                        <span className="font-mono font-semibold text-white">{c.maletasProcesadas.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Cumplimiento</span>
                        <span className={`font-mono font-semibold ${cumText}`}>{c.cumplimiento}%</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-xs">Almacenes críticos: </span>
                        <span className="text-red-400 text-xs font-mono">{c.almacenesCriticos.join(', ')}</span>
                      </div>
                    </div>
                  </div>
                )
              })
          }
        </div>

        {/* Ranking aeropuertos */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700 flex items-center gap-4">
            <div className="flex-1">
              <h2 className="font-semibold text-white">Ranking de Ocupación por Aeropuerto</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {airports
                  ? 'Aeropuertos del sistema — ocupación actual no disponible en este endpoint'
                  : 'Ordenado por mayor ocupación de almacén'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Promedio ocupación almacenes:
                <span className="font-mono font-semibold text-slate-300 ml-1">{promAlmacenes}%</span>
                {airports && (
                  <span
                    className="ml-1.5 text-amber-500 cursor-help"
                    title="Con datos reales del backend el valor es siempre 0% porque el endpoint /api/v1/airports no expone la ocupación actual. Se requiere un endpoint de estado de almacenes."
                  >⚠</span>
                )}
              </p>
            </div>
            <input
              type="text"
              value={filtroTexto}
              onChange={e => setFiltroTexto(e.target.value)}
              placeholder="Filtrar por código..."
              className="bg-slate-700 border border-slate-600 text-slate-200 text-xs rounded px-3 py-1.5 w-44 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <select
              value={filtroContinente}
              onChange={e => setFiltroContinente(e.target.value)}
              className="bg-slate-700 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1.5 cursor-pointer focus:outline-none focus:border-blue-500"
            >
              <option value="Todos">Todos</option>
              {continentesUnicos.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/40 text-slate-400 text-xs uppercase">
                  <th className="text-left px-4 py-3">#</th>
                  <th className="text-left px-4 py-3">Código</th>
                  <th className="text-left px-4 py-3">Continente</th>
                  <th className="text-left px-4 py-3">Almacén</th>
                  <th
                    className="text-left px-4 py-3 w-40 cursor-pointer select-none hover:text-slate-200 transition-colors"
                    onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                  >
                    Ocupación {sortDir === 'desc' ? '▼' : '▲'}
                  </th>
                  <th className="text-left px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {rankingAeropuertos.map((ap, i) => {
                  const sem = SEMAFORO_LABEL[ap.color] ?? SEMAFORO_LABEL.verde
                  return (
                    <tr key={ap.codigo} className="hover:bg-slate-700/20 transition-colors">
                      <td className="px-4 py-3 text-slate-500 font-mono">{i + 1}</td>
                      <td className="px-4 py-3 font-mono font-bold text-white">{ap.codigo}</td>
                      <td className="px-4 py-3 text-slate-400">{ap.continente}</td>
                      <td className="px-4 py-3 font-mono text-slate-300">
                        {ap.almacen.actual.toLocaleString()}/{ap.almacen.capacidad.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <BarraProgreso pct={ap.pct} color={ap.color} height="h-2" showLabel />
                      </td>
                      <td className="px-4 py-3">
                        <SemaforoBadge color={sem.color} label={sem.label} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}

function MetricaVuelo({ label, value, color }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-400 text-sm">{label}</span>
      <span className={`font-mono font-bold text-lg ${color}`}>{value}</span>
    </div>
  )
}
