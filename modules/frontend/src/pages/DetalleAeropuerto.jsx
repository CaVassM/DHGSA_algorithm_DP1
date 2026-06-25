import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getAirports, getFlights, getPlanningRunRoutes } from '../services/api'
import NavBar from '../components/NavBar'
import SemaforoBadge from '../components/SemaforoBadge'
import BarraProgreso from '../components/BarraProgreso'

const LS_KEY = 'tasf_runId'

// Reconstruye los tramos (legs) de una ruta usando el mapa de vuelos:
// cada flightBusinessId -> { desde, hasta }.
function legsDeRuta(ruta, flightMap) {
  return (ruta.flightBusinessIds ?? [])
    .map(fid => flightMap.get(fid))
    .filter(Boolean)
    .map(f => ({ desde: f.origenIcao, hasta: f.destinoIcao }))
}

export default function DetalleAeropuerto() {
  const { codigo } = useParams()
  const navigate = useNavigate()
  const icao = codigo?.toUpperCase()

  const runId = (() => {
    const s = localStorage.getItem(LS_KEY)
    return s ? Number(s) : null
  })()

  const [airport, setAirport] = useState(null)
  const [noExiste, setNoExiste] = useState(false)
  const [flights, setFlights] = useState([])
  const [routes, setRoutes] = useState([])

  useEffect(() => {
    getAirports(0, 500)
      .then(page => {
        const ap = (page.content ?? []).find(a => a.codigoIcao === icao)
        if (ap) setAirport(ap); else setNoExiste(true)
      })
      .catch(() => setNoExiste(true))
  }, [icao])

  useEffect(() => {
    getFlights(0, 500).then(page => setFlights(page.content ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (!runId) return
    getPlanningRunRoutes(runId).then(list => setRoutes(list ?? [])).catch(() => {})
  }, [runId])

  const flightMap = useMemo(() => new Map(flights.map(f => [f.businessId, f])), [flights])

  // Clasifica cada ruta respecto a este aeropuerto: destino final / tránsito /
  // origen, y de ahí deriva entradas, salidas y "maletas en almacén" (T28/31/33).
  const { entran, salen, enAlmacen } = useMemo(() => {
    const entran = []   // rutas cuyo recorrido LLEGA a este aeropuerto
    const salen = []    // rutas cuyo recorrido SALE de este aeropuerto
    const enAlmacen = [] // envíos presentes en el almacén (origen o en tránsito aquí)

    for (const r of routes) {
      const legs = legsDeRuta(r, flightMap)
      if (legs.length === 0) continue
      const llegaAqui = legs.some(l => l.hasta === icao)
      const saleAqui = legs.some(l => l.desde === icao)
      const esDestinoFinal = r.destinoIcao === icao
      const esOrigen = r.origenIcao === icao

      const base = {
        envio: r.shipmentBusinessId,
        desde: r.origenIcao,
        hasta: r.destinoIcao,
        maletas: r.cantidadMaletas ?? 0,
        directa: r.esDirecta,
        escalas: r.escalas ?? 0,
      }

      if (llegaAqui) entran.push({ ...base, tipo: esDestinoFinal ? 'DESTINO FINAL' : 'EN TRÁNSITO' })
      if (saleAqui) salen.push({ ...base, tipo: esOrigen ? 'ORIGEN' : 'EN TRÁNSITO' })

      // En el almacén están: los que tienen este aeropuerto como origen (esperan
      // salir) o los que pasan en tránsito (llegan aquí y no es su destino final).
      if (esOrigen || (llegaAqui && !esDestinoFinal)) {
        enAlmacen.push({ ...base, tipo: esDestinoFinal ? 'DESTINO FINAL' : esOrigen ? 'ORIGEN' : 'EN TRÁNSITO' })
      } else if (esDestinoFinal && llegaAqui) {
        enAlmacen.push({ ...base, tipo: 'DESTINO FINAL' })
      }
    }
    entran.sort((a, b) => b.maletas - a.maletas)
    salen.sort((a, b) => b.maletas - a.maletas)
    enAlmacen.sort((a, b) => b.maletas - a.maletas)
    return { entran, salen, enAlmacen }
  }, [routes, flightMap, icao])

  const maletasEnAlmacen = enAlmacen.reduce((acc, e) => acc + e.maletas, 0)
  const capacidad = airport?.capacidadAlmacen ?? 0
  const pct = capacidad > 0 ? Math.round((maletasEnAlmacen / capacidad) * 100) : 0
  const color = pct === 0 ? 'vacio' : pct > 85 ? 'rojo' : pct >= 60 ? 'ambar' : 'verde'
  const barTextColor = { vacio: 'text-slate-300', verde: 'text-green-400', ambar: 'text-amber-400', rojo: 'text-red-400' }[color]

  if (noExiste) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">✈</div>
          <h2 className="text-2xl font-bold text-white mb-2">Aeropuerto no encontrado</h2>
          <p className="text-slate-400 mb-4">El código "{codigo}" no existe en el sistema.</p>
          <button onClick={() => navigate('/dashboard')} className="text-blue-400 hover:text-blue-300">
            ← Volver al Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col">
      <NavBar />
      <div className="flex-1 p-6 max-w-6xl mx-auto w-full">

        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => navigate('/dashboard')}
            className="text-slate-400 hover:text-white transition-colors text-sm flex items-center gap-1">
            ← Volver al Mapa
          </button>
          <div className="h-4 w-px bg-slate-600" />
          <div>
            <h1 className="text-2xl font-bold text-white">
              {airport ? `${airport.ciudad} (${airport.codigoIcao})` : icao}
            </h1>
            {airport && (
              <span className="inline-block mt-1 text-xs font-semibold text-slate-400 bg-slate-700 px-2 py-0.5 rounded uppercase tracking-wider">
                {airport.pais}{airport.continente ? ` · ${airport.continente}` : ''}
              </span>
            )}
          </div>
          {!runId && (
            <span className="ml-auto text-xs text-amber-400">Sin simulación activa — inicia una para ver envíos planificados.</span>
          )}
        </div>

        {/* Barra de capacidad (derivada de envíos planificados en almacén) */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-slate-400 font-medium">Carga planificada en el almacén</span>
            <span className={`font-mono font-bold text-lg ${barTextColor}`}>
              {maletasEnAlmacen.toLocaleString()}/{capacidad.toLocaleString()} maletas — {pct}% OCUPADO
            </span>
          </div>
          <BarraProgreso pct={pct} color={color} height="h-3" />
        </div>

        {/* Maletas en almacén con destino final vs tránsito (T28) */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-slate-700 flex justify-between items-center">
            <h2 className="font-semibold text-white">Envíos en el almacén</h2>
            <span className="text-xs text-slate-400 bg-slate-700 px-2 py-0.5 rounded">{enAlmacen.length} envíos</span>
          </div>
          <ListaEnvios items={enAlmacen} vacioMsg="Sin envíos en el almacén para esta simulación." conTipo />
        </div>

        {/* Dos columnas: entran / salen */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* T31 — Entran */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700 flex justify-between items-center">
              <h2 className="font-semibold text-white">Envíos que ENTRAN</h2>
              <span className="text-xs text-slate-400 bg-slate-700 px-2 py-0.5 rounded">{entran.length}</span>
            </div>
            <ListaEnvios items={entran} vacioMsg="Sin envíos entrantes planificados." conTipo />
          </div>

          {/* T33 — Salen */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700 flex justify-between items-center">
              <h2 className="font-semibold text-white">Envíos que SALEN</h2>
              <span className="text-xs text-slate-400 bg-slate-700 px-2 py-0.5 rounded">{salen.length}</span>
            </div>
            <ListaEnvios items={salen} vacioMsg="Sin envíos salientes planificados." conTipo />
          </div>
        </div>
      </div>
    </div>
  )
}

const TIPO_COLOR = {
  'DESTINO FINAL': 'verde',
  'EN TRÁNSITO':   'ambar',
  'ORIGEN':        'azul',
}

function ListaEnvios({ items, vacioMsg, conTipo }) {
  if (!items || items.length === 0) {
    return <p className="p-5 text-slate-400 text-sm text-center">{vacioMsg}</p>
  }
  return (
    <div className="divide-y divide-slate-700/50 max-h-[420px] overflow-y-auto">
      {items.map((e) => (
        <div key={e.envio + e.tipo} className="flex items-center justify-between px-5 py-3 hover:bg-slate-700/30 transition-colors">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono text-xs text-blue-300">{e.envio}</span>
            <span className="text-xs text-slate-500">·</span>
            <span className="text-xs text-slate-300 whitespace-nowrap">{e.desde} → {e.hasta}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="font-mono text-xs text-slate-400">{e.maletas.toLocaleString()} mal.</span>
            {conTipo && <SemaforoBadge color={TIPO_COLOR[e.tipo] ?? 'azul'} label={e.tipo} />}
          </div>
        </div>
      ))}
    </div>
  )
}
