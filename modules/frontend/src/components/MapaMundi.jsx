import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Marker,
  Polyline,
  Tooltip,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
import {
  AEROPUERTOS,
  RUTAS,
  getOcupacionPct,
  getSemaforoPorOcupacion,
  SEMAFORO_COLORES,
  UMBRALES_ALMACEN,
} from '../data/aeropuertos'
import { getAirports, getFlights, getPlanningRunRoutes } from '../services/api'

// Returns the next Date at HH:mm that is strictly after `afterDate`.
function getNextDeparture(horaSalida, afterDate) {
  const [h, m] = horaSalida.split(':').map(Number)
  const d = new Date(afterDate)
  d.setHours(h, m, 0, 0)
  if (d <= afterDate) d.setDate(d.getDate() + 1)
  return d
}

// Reconstructs per-leg { desde, hasta, salida: Date, llegada: Date, ... }
function buildRouteLegs(route, flightMap) {
  let cursor = new Date(route.tiempoInicio)
  return (route.flightBusinessIds ?? []).flatMap(fid => {
    const flight = flightMap.get(fid)
    if (!flight) return []
    const salida = getNextDeparture(flight.horaSalida, cursor)
    const llegada = new Date(salida.getTime() + flight.duracionMinutos * 60 * 1000)
    cursor = llegada
    return [{
      shipmentId: route.shipmentBusinessId,
      cantidadMaletas: route.cantidadMaletas ?? 0,
      desde: flight.origenIcao,
      hasta: flight.destinoIcao,
      salida,
      llegada,
      capacidadVuelo: flight.capacidad ?? 0,
    }]
  })
}

function formatSimDateTime(date) {
  if (!date) return '-'
  const p = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`
}

function formatRealTime(date) {
  if (!date) return '--:--:--'
  const p = n => String(n).padStart(2, '0')
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
}

function formatElapsed(ms) {
  if (ms == null || ms < 0) return '-'
  const totalMin = Math.floor(ms / 60000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  return `${d}d ${h}h ${m}m`
}

function getPlaneColors(pct) {
  if (pct <= UMBRALES_ALMACEN.vacio) return { fill: '#94a3b8', stroke: '#cbd5e1' }
  if (pct > 85) return { fill: '#f87171', stroke: '#fecaca' }
  if (pct >= 60) return { fill: '#fbbf24', stroke: '#fde68a' }
  return { fill: '#4ade80', stroke: '#bbf7d0' }
}

function getHeadingAngle(from, to) {
  const dx = to.lng - from.lng
  const dy = to.lat - from.lat
  return Math.atan2(-dy, dx) * (180 / Math.PI)
}

function createPlaneIcon({ fill, stroke, angle, count }) {
  const badgeHtml = count > 1 ? `<div class="tasf-plane-badge">${count}</div>` : ''
  return L.divIcon({
    className: 'tasf-plane-icon-wrapper',
    html: `
      <div class="tasf-plane-icon" style="--plane-rotation:${angle.toFixed(1)}deg;">
        <svg viewBox="-8 -8 16 16" width="26" height="26" aria-hidden="true">
          <path
            d="M 7,0 L 2,-1.6 L 0,-5 L -2,-2.6 L -3.6,-3.5 L -4.6,-2 L -5,-1 L -5,1 L -4.6,2 L -3.6,3.5 L -2,2.6 L 0,5 L 2,1.6 Z"
            fill="${fill}"
            stroke="${stroke}"
            stroke-width="1"
          />
        </svg>
        ${badgeHtml}
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

function fallbackPctToLatLng(ap) {
  const x = parseFloat(ap.mapX ?? '')
  const y = parseFloat(ap.mapY ?? '')
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const lng = (x / 100) * 360 - 180
  const lat = 90 - (y / 100) * 180
  return { latitud: lat, longitud: lng }
}

function adaptAirport(ap) {
  return {
    codigo: ap.codigoIcao,
    nombre: `${ap.ciudad} (${ap.codigoIcao})`,
    ciudad: ap.ciudad,
    continente: ap.continente ?? ap.pais,
    latitud: ap.latitud,
    longitud: ap.longitud,
    almacen: { actual: 0, capacidad: ap.capacidadAlmacen },
    maletasEnRiesgo: 0,
    vuelosProximos: 0,
    ultimaActualizacion: '-',
  }
}

const SPEED_OPTIONS = [1, 10, 30, 60, 120]

function fitMapToAirports(map, airportsByCode) {
  const points = Object.values(airportsByCode)
    .filter(ap => Number.isFinite(ap.latitud) && Number.isFinite(ap.longitud))
    .map(ap => [ap.latitud, ap.longitud])

  if (points.length === 0) {
    map.setView([10, -20], 2)
    map.setMinZoom(2)
    map.setMaxBounds(L.latLngBounds([[-85, -180], [85, 180]]))
    return
  }

  const bounds = L.latLngBounds(points)
  map.fitBounds(bounds.pad(0.35), { padding: [24, 24], maxZoom: 5 })
  const fitZoom = map.getZoom()
  map.setMinZoom(Math.max(2, fitZoom - 1))
  map.setMaxBounds(bounds.pad(1.2))
}

function MapViewportController({ airportsByCode, resetNonce }) {
  const map = useMap()
  const fitKey = useMemo(
    () => Object.values(airportsByCode)
      .filter(ap => Number.isFinite(ap.latitud) && Number.isFinite(ap.longitud))
      .map(ap => `${ap.codigo}:${ap.latitud.toFixed(4)},${ap.longitud.toFixed(4)}`)
      .sort()
      .join('|'),
    [airportsByCode],
  )
  const lastFitKeyRef = useRef('')

  useEffect(() => {
    if (!fitKey || fitKey === lastFitKeyRef.current) return
    fitMapToAirports(map, airportsByCode)
    lastFitKeyRef.current = fitKey
  }, [map, airportsByCode, fitKey])

  useEffect(() => {
    if (resetNonce === 0) return
    fitMapToAirports(map, airportsByCode)
  }, [map, airportsByCode, resetNonce])

  // Leaflet no re-renderiza al cambiar el tamaño de su contenedor (p. ej. al
  // colapsar/expandir el panel lateral), dejando una franja gris sin teselas.
  // Un ResizeObserver lo fuerza a recalcular su tamaño.
  useEffect(() => {
    const container = map.getContainer()
    if (!container || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(container)
    return () => ro.disconnect()
  }, [map])

  return null
}

export default function MapaMundi({ runId, runCompleted = false }) {
  const navigate = useNavigate()
  const timerRef = useRef(null)

  const [airports, setAirports] = useState(null)
  const [routes, setRoutes] = useState(null)
  const [flights, setFlights] = useState([])

  const [simTime, setSimTime] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playSpeed, setPlaySpeed] = useState(60)

  const [realTime, setRealTime] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setRealTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const [mapInstance, setMapInstance] = useState(null)
  const [resetNonce, setResetNonce] = useState(0)

  useEffect(() => {
    getAirports()
      .then(page => {
        const map = {}
        ;(page.content ?? []).forEach(ap => {
          const adapted = adaptAirport(ap)
          map[adapted.codigo] = adapted
        })
        if (Object.keys(map).length > 0) setAirports(map)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!runId) return
    getPlanningRunRoutes(runId)
      .then(list => {
        const valid = list.filter(r => r.origenIcao && r.destinoIcao)
        setRoutes(valid)
        const starts = valid.map(r => r.tiempoInicio).filter(Boolean).sort()
        if (starts.length > 0) setSimTime(new Date(starts[0]))
      })
      .catch(() => {})
  }, [runId, runCompleted])

  useEffect(() => {
    getFlights(0, 500)
      .then(page => setFlights(page.content ?? []))
      .catch(() => {})
  }, [])

  const aeropuertosActivos = useMemo(() => {
    const base = airports ?? AEROPUERTOS
    const out = {}
    Object.entries(base).forEach(([code, ap]) => {
      if (Number.isFinite(ap.latitud) && Number.isFinite(ap.longitud)) {
        out[code] = ap
        return
      }
      const fallback = fallbackPctToLatLng(ap)
      out[code] = fallback ? { ...ap, ...fallback } : ap
    })
    return out
  }, [airports])

  const allLegs = useMemo(() => {
    if (!routes || routes.length === 0 || flights.length === 0) return []
    const flightMap = new Map(flights.map(f => [f.businessId, f]))
    return routes.flatMap(r => buildRouteLegs(r, flightMap))
  }, [routes, flights])

  const almacenOcupacion = useMemo(() => {
    if (!simTime || allLegs.length === 0) return {}

    const byShipment = {}
    allLegs.forEach(leg => {
      ;(byShipment[leg.shipmentId] ??= []).push(leg)
    })

    const ocupacion = {}
    Object.values(byShipment).forEach(legs => {
      const maletas = legs[0].cantidadMaletas
      let location = null

      if (simTime < legs[0].salida) {
        location = legs[0].desde
      } else {
        for (let i = 0; i < legs.length; i++) {
          const leg = legs[i]
          if (simTime >= leg.salida && simTime <= leg.llegada) {
            location = null
            break
          }
          if (simTime > leg.llegada) {
            const next = legs[i + 1]
            if (!next) { location = leg.hasta; break }
            if (simTime < next.salida) { location = leg.hasta; break }
          }
        }
      }

      if (location) ocupacion[location] = (ocupacion[location] ?? 0) + maletas
    })

    return ocupacion
  }, [allLegs, simTime])

  const aeropuertosConOcupacion = useMemo(() => {
    if (Object.keys(almacenOcupacion).length === 0) return aeropuertosActivos
    const result = {}
    Object.entries(aeropuertosActivos).forEach(([code, ap]) => {
      result[code] = {
        ...ap,
        almacen: { ...ap.almacen, actual: almacenOcupacion[code] ?? 0 },
      }
    })
    return result
  }, [aeropuertosActivos, almacenOcupacion])

  const rutasLineas = useMemo(() => {
    if (routes === null) {
      return (airports ? [] : RUTAS).map(r => ({ ...r, revealAt: null }))
    }

    if (allLegs.length === 0) {
      return Array.from(
        new Map(routes.map(r => [
          `${r.origenIcao}-${r.destinoIcao}`,
          { desde: r.origenIcao, hasta: r.destinoIcao, revealAt: null },
        ])).values(),
      )
    }

    const map = {}
    allLegs.forEach(leg => {
      const key = `${leg.desde}-${leg.hasta}`
      if (!map[key] || leg.salida < map[key].revealAt) {
        map[key] = { desde: leg.desde, hasta: leg.hasta, revealAt: leg.salida }
      }
    })
    return Object.values(map)
  }, [allLegs, routes, airports])

  const simStart = useMemo(() => {
    if (!routes || routes.length === 0) return null
    const ts = routes.map(r => r.tiempoInicio).filter(Boolean).sort()
    return ts.length > 0 ? new Date(ts[0]) : null
  }, [routes])

  const simEnd = useMemo(() => {
    if (!routes || routes.length === 0) return null
    const ts = routes.map(r => r.tiempoLlegadaEstimado).filter(Boolean).sort()
    return ts.length > 0 ? new Date(ts[ts.length - 1]) : null
  }, [routes])

  const activeLegs = simTime
    ? allLegs
        .filter(leg => leg.salida <= simTime && simTime <= leg.llegada)
        .map(leg => ({ ...leg, progreso: (simTime - leg.salida) / (leg.llegada - leg.salida) }))
    : []

  const activeDotMap = {}
  activeLegs.forEach(leg => {
    const key = `${leg.desde}-${leg.hasta}`
    if (!activeDotMap[key]) {
      activeDotMap[key] = {
        desde: leg.desde,
        hasta: leg.hasta,
        progreso: leg.progreso,
        count: 0,
        maletas: 0,
        capacidadTotal: 0,
      }
    }
    activeDotMap[key].count += 1
    activeDotMap[key].maletas += leg.cantidadMaletas
    activeDotMap[key].capacidadTotal += leg.capacidadVuelo ?? 0
  })
  const activeDots = Object.values(activeDotMap)

  const simProgress = simStart && simEnd && simTime
    ? Math.min(1, Math.max(0, (simTime - simStart) / (simEnd - simStart)))
    : 0

  useEffect(() => {
    clearInterval(timerRef.current)
    if (!isPlaying || !simEnd) return

    timerRef.current = setInterval(() => {
      setSimTime(t => {
        if (!t) return t
        const next = new Date(t.getTime() + playSpeed * 60 * 1000)
        if (next >= simEnd) {
          setIsPlaying(false)
          return new Date(simEnd)
        }
        return next
      })
    }, 1000)

    return () => clearInterval(timerRef.current)
  }, [isPlaying, playSpeed, simEnd])

  const coords = useMemo(() => {
    const c = {}
    Object.values(aeropuertosConOcupacion).forEach(ap => {
      if (Number.isFinite(ap.latitud) && Number.isFinite(ap.longitud)) {
        c[ap.codigo] = { lat: ap.latitud, lng: ap.longitud }
      }
    })
    return c
  }, [aeropuertosConOcupacion])

  function zoomIn() {
    mapInstance?.zoomIn()
  }

  function zoomOut() {
    mapInstance?.zoomOut()
  }

  function resetView() {
    if (!mapInstance) return
    setResetNonce(v => v + 1)
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0c1a2e] select-none">
      <MapContainer
        className="w-full h-full"
        zoomControl={false}
        scrollWheelZoom="center"
        maxBoundsViscosity={1.0}
        ref={setMapInstance}
      >
        <MapViewportController airportsByCode={aeropuertosActivos} resetNonce={resetNonce} />

        <TileLayer
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        {rutasLineas
          .filter(r => !r.revealAt || !simTime || simTime >= r.revealAt)
          .map(ruta => {
            const a = coords[ruta.desde]
            const b = coords[ruta.hasta]
            if (!a || !b) return null
            return (
              <Polyline
                key={`${ruta.desde}-${ruta.hasta}`}
                positions={[[a.lat, a.lng], [b.lat, b.lng]]}
                pathOptions={{ color: '#3b82f6', weight: 2, opacity: 0.5, dashArray: '6 6' }}
              />
            )
          })}

        {activeDots.map(dot => {
          const a = coords[dot.desde]
          const b = coords[dot.hasta]
          if (!a || !b) return null

          const t = dot.progreso
          const lat = a.lat + (b.lat - a.lat) * t
          const lng = a.lng + (b.lng - a.lng) * t
          const pct = dot.capacidadTotal > 0 ? (dot.maletas / dot.capacidadTotal) * 100 : 0
          const color = getPlaneColors(pct)
          const angle = getHeadingAngle(a, b)
          const planeIcon = createPlaneIcon({ fill: color.fill, stroke: color.stroke, angle, count: dot.count })

          return (
            <Marker
              key={`${dot.desde}-${dot.hasta}`}
              position={[lat, lng]}
              icon={planeIcon}
            >
              <Tooltip direction="top" offset={[0, -10]} className="tasf-tooltip" opacity={1}>
                <div className="text-xs">
                  <div className="font-bold text-white mb-1">{dot.desde} {'->'} {dot.hasta}</div>
                  <div className="text-slate-300">Envios: <span className="text-blue-300 font-semibold">{dot.count}</span></div>
                  <div className="text-slate-300">Maletas: <span className="text-blue-300 font-semibold">{dot.maletas.toLocaleString()}</span></div>
                  <div className="text-slate-300">Progreso: <span className="text-slate-200 font-semibold">{Math.round(dot.progreso * 100)}%</span></div>
                </div>
              </Tooltip>
            </Marker>
          )
        })}

        {Object.values(aeropuertosConOcupacion).map(ap => {
          const pos = coords[ap.codigo]
          if (!pos) return null

          const pct = getOcupacionPct(ap)
          const color = getSemaforoPorOcupacion(pct)
          const hex = SEMAFORO_COLORES[color]

          return (
            <CircleMarker
              key={ap.codigo}
              center={[pos.lat, pos.lng]}
              radius={9}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: hex, fillOpacity: 0.92 }}
              eventHandlers={{
                click: () => navigate(`/aeropuerto/${ap.codigo}`),
              }}
            >
              <Tooltip direction="right" offset={[8, 0]} className="tasf-tooltip" opacity={1}>
                <div className="text-xs min-w-[180px]">
                  <div className="font-bold text-white text-sm mb-0.5">{ap.nombre}</div>
                  <div className="text-blue-300 font-mono mb-1">{ap.codigo}</div>
                  <div className="text-slate-400 mb-1">{ap.ciudad} - {ap.continente}</div>
                  <div className="text-slate-300">Ocupacion: <span className="font-semibold text-green-300">{ap.almacen.actual.toLocaleString()}/{ap.almacen.capacidad.toLocaleString()}</span></div>
                  <div className="text-slate-300">Riesgo: <span className="text-amber-300">{ap.maletasEnRiesgo}</span></div>
                  <div className="text-blue-300 mt-1">Hover + click para ver detalles {'->'}</div>
                </div>
              </Tooltip>
            </CircleMarker>
          )
        })}
      </MapContainer>

      <div className="absolute top-3 left-3 z-[1000] flex flex-col gap-2 pointer-events-none">

        {/* Tarjeta: Tiempo simulado */}
        {simTime && (
          <div className="bg-slate-950/95 backdrop-blur border border-blue-500/25 rounded-xl overflow-hidden min-w-[220px] shadow-lg shadow-black/50">
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/60 border-b border-slate-700/60">
              <svg className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
              </svg>
              <span className="text-[10px] text-slate-300 uppercase tracking-widest font-semibold">Tiempo simulado</span>
            </div>
            <div className="flex items-end gap-5 p-4">
              <div>
                <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Fecha</p>
                <p className="text-sm text-slate-300 font-mono">{formatSimDateTime(simTime).split(' ')[0]}</p>
              </div>
              <div>
                <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Hora</p>
                <p className="text-5xl font-bold font-mono text-white leading-none">{formatSimDateTime(simTime).split(' ')[1]}</p>
              </div>
            </div>
            <div className="px-4 pt-3 pb-4 border-t border-slate-700/50">
              <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Transcurrido</p>
              <p className="text-base font-mono text-green-400">+{formatElapsed(simStart ? simTime - simStart : null)}</p>
            </div>
          </div>
        )}

        {/* Tarjeta: Hora real */}
        <div className="bg-slate-950/90 backdrop-blur border border-emerald-500/20 rounded-xl overflow-hidden min-w-[220px] shadow-md shadow-black/40">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 border-b border-slate-700/60">
            <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
            </svg>
            <span className="text-[10px] text-slate-300 uppercase tracking-widest font-semibold">Hora real</span>
          </div>
          <div className="flex items-end gap-5 px-4 pt-3 pb-3">
            <div>
              <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Fecha</p>
              <p className="text-sm text-slate-300 font-mono">{formatSimDateTime(realTime).split(' ')[0]}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Hora</p>
              <p className="text-2xl font-bold font-mono text-emerald-400 leading-none">{formatRealTime(realTime)}</p>
            </div>
          </div>
        </div>

      </div>

      <div className="absolute top-3 right-3 flex flex-col gap-1 z-[1000]">
        <ZoomButton label="+" title="Acercar" onClick={zoomIn} />
        <ZoomButton label="-" title="Alejar" onClick={zoomOut} />
        <div className="h-px bg-slate-600 my-0.5" />
        <ZoomButton label="R" title="Restablecer vista" onClick={resetView} />
      </div>

      {simTime && (
        <div className="absolute bottom-14 left-4 right-4 z-[1000]">
          <div className="bg-slate-900/92 backdrop-blur border border-slate-700 rounded-xl px-4 py-2.5 flex items-center gap-3">
            <button
              onClick={() => setIsPlaying(p => !p)}
              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold transition-colors"
              title={isPlaying ? 'Pausar' : 'Reproducir'}
            >
              {isPlaying ? '||' : '>'}
            </button>

            <select
              value={playSpeed}
              onChange={e => setPlaySpeed(Number(e.target.value))}
              className="shrink-0 bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1 cursor-pointer focus:outline-none focus:border-blue-500"
            >
              {SPEED_OPTIONS.map(v => (
                <option key={v} value={v}>{v}x</option>
              ))}
            </select>

<div
              className="flex-1 bg-slate-700/80 rounded-full h-1.5 cursor-pointer"
              onClick={e => {
                if (!simStart || !simEnd) return
                const rect = e.currentTarget.getBoundingClientRect()
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                setSimTime(new Date(simStart.getTime() + ratio * (simEnd - simStart)))
              }}
            >
              <div
                className="bg-blue-500 h-1.5 rounded-full pointer-events-none"
                style={{ width: `${simProgress * 100}%`, transition: isPlaying ? 'width 0.9s linear' : 'none' }}
              />
            </div>

            <span className="shrink-0 text-xs font-mono min-w-[6rem] text-right text-blue-400">
              {activeLegs.length > 0 ? `${activeLegs.length} en vuelo` : 'sin vuelos'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function ZoomButton({ label, title, onClick }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="w-8 h-8 flex items-center justify-center rounded bg-slate-800/90 hover:bg-slate-700 active:bg-slate-600 border border-slate-600 text-white text-base font-bold transition-colors shadow-lg"
    >
      {label}
    </button>
  )
}
