import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { feature } from 'topojson-client'
import worldData from 'world-atlas/countries-110m.json'
import { AEROPUERTOS, RUTAS, getOcupacionPct, getSemaforoPorOcupacion, SEMAFORO_COLORES } from '../data/aeropuertos'
import { getAirports, getFlights, getPlanningRunRoutes } from '../services/api'

// ---------------------------------------------------------------------------
// Equirectangular projection → SVG 1000×500
// ---------------------------------------------------------------------------
function geoProject(lon, lat) {
  return [(lon + 180) / 360 * 1000, (90 - lat) / 180 * 500]
}

function ringToSVG(ring) {
  if (!ring || ring.length < 2) return ''
  let d = ''
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = geoProject(ring[i][0], ring[i][1])
    d += i === 0
      ? `M${x.toFixed(1)},${y.toFixed(1)}`
      : `L${x.toFixed(1)},${y.toFixed(1)}`
  }
  return d + 'Z'
}

function featureToD(f) {
  if (!f?.geometry) return ''
  const { type, coordinates } = f.geometry
  if (type === 'Polygon')      return coordinates.map(ringToSVG).join('')
  if (type === 'MultiPolygon') return coordinates.map(p => p.map(ringToSVG).join('')).join('')
  return ''
}

const COUNTRY_PATHS = feature(worldData, worldData.objects.countries)
  .features.map(featureToD).filter(Boolean)

// ---------------------------------------------------------------------------
// mapX/mapY percentage → SVG coordinate
// ---------------------------------------------------------------------------
function pctToXY(xPct, yPct) {
  return { x: parseFloat(xPct) * 10, y: parseFloat(yPct) * 5 }
}

// ---------------------------------------------------------------------------
// Per-leg timestamp reconstruction
// ---------------------------------------------------------------------------

// Returns the next Date at HH:mm that is strictly after `afterDate`.
function getNextDeparture(horaSalida, afterDate) {
  const [h, m] = horaSalida.split(':').map(Number)
  const d = new Date(afterDate)
  d.setHours(h, m, 0, 0)
  if (d <= afterDate) d.setDate(d.getDate() + 1)
  return d
}

// Reconstructs per-leg { desde, hasta, salida: Date, llegada: Date, ... }
// from a RouteResponse using the same "advance-to-next-day" logic as the backend.
function buildRouteLegs(route, flightMap) {
  let cursor = new Date(route.tiempoInicio)
  return (route.flightBusinessIds ?? []).flatMap(fid => {
    const flight = flightMap.get(fid)
    if (!flight) return []
    const salida  = getNextDeparture(flight.horaSalida, cursor)
    const llegada = new Date(salida.getTime() + flight.duracionMinutos * 60 * 1000)
    cursor = llegada
    return [{
      shipmentId:      route.shipmentBusinessId,
      cantidadMaletas: route.cantidadMaletas ?? 0,
      desde:           flight.origenIcao,
      hasta:           flight.destinoIcao,
      salida,
      llegada,
    }]
  })
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
function formatSimDateTime(date) {
  if (!date) return '—'
  const p = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`
}

// ---------------------------------------------------------------------------
// Adapt AirportResponse → internal map format
// ---------------------------------------------------------------------------
function adaptAirport(ap) {
  return {
    codigo:              ap.codigoIcao,
    nombre:              `${ap.ciudad} (${ap.codigoIcao})`,
    ciudad:              ap.ciudad,
    continente:          ap.continente ?? ap.pais,
    mapX:                `${((ap.longitud + 180) / 360 * 100).toFixed(2)}%`,
    mapY:                `${((90 - ap.latitud)  / 180 * 100).toFixed(2)}%`,
    almacen:             { actual: 0, capacidad: ap.capacidadAlmacen },
    maletasEnRiesgo:     0,
    vuelosProximos:      0,
    ultimaActualizacion: '—',
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SCALE_MIN      = 0.5
const SCALE_MAX      = 8
const ZOOM_FACTOR    = 1.3
const DRAG_THRESHOLD = 4
const INITIAL_TRANSFORM = { scale: 1, tx: 0, ty: 0 }
const SPEED_OPTIONS  = [1, 10, 30, 60, 120]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function MapaMundi({ runId, runCompleted = false }) {
  const navigate     = useNavigate()
  const svgRef       = useRef(null)
  const containerRef = useRef(null)
  const timerRef     = useRef(null)

  // ── Tooltip state ──────────────────────────────────────────────────────────
  const [tooltipAeropuerto, setTooltipAeropuerto] = useState(null)
  const [tooltipDot,        setTooltipDot]        = useState(null)
  const [mousePos,          setMousePos]          = useState({ x: 0, y: 0 })

  // ── Data state ─────────────────────────────────────────────────────────────
  const [airports, setAirports] = useState(null)
  const [routes,   setRoutes]   = useState(null)  // RouteResponse[] | null
  const [flights,  setFlights]  = useState([])

  // ── Simulation clock ───────────────────────────────────────────────────────
  const [simTime,   setSimTime]   = useState(null)  // Date | null
  const [isPlaying, setIsPlaying] = useState(false)
  const [playSpeed, setPlaySpeed] = useState(60)    // minutes advanced per real second

  // ── Zoom/pan state ─────────────────────────────────────────────────────────
  const [transform, setTransform] = useState(INITIAL_TRANSFORM)
  const [isPanning, setIsPanning] = useState(false)

  const transformRef = useRef(INITIAL_TRANSFORM)
  const dragState    = useRef(null)
  const isDragging   = useRef(false)

  // ── Data effects ───────────────────────────────────────────────────────────

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
        console.log('[MapaMundi] raw routes:', list)
        const valid = list.filter(r => r.origenIcao && r.destinoIcao)
        setRoutes(valid)
        // Seed clock to earliest tiempoInicio across all routes
        const starts = valid.map(r => r.tiempoInicio).filter(Boolean).sort()
        if (starts.length > 0) setSimTime(new Date(starts[0]))
      })
      .catch(err => console.error('[MapaMundi] fetch rutas fallido:', err))
  }, [runId, runCompleted])

  useEffect(() => {
    getFlights(0, 500)
      .then(page => setFlights(page.content ?? []))
      .catch(() => {})
  }, [])

  // ── Derived data ──────────────────────────────────────────────────────────
  // Declared before the timer effect so simEnd is initialized when useEffect
  // evaluates its dependency array (avoids Temporal Dead Zone error).

  const aeropuertosActivos = airports ?? AEROPUERTOS

  // Deduplicated origin-destination pairs → static route lines on the map
  const rutasLineas = useMemo(() => {
    if (routes === null) return airports ? [] : RUTAS
    return Array.from(
      new Map(routes.map(r => [`${r.origenIcao}-${r.destinoIcao}`, { desde: r.origenIcao, hasta: r.destinoIcao }])).values()
    )
  }, [routes, airports])

  // Simulation time boundaries (Date objects)
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

  // Pre-computed legs for every route with exact Date timestamps
  const allLegs = useMemo(() => {
    if (!routes || routes.length === 0 || flights.length === 0) return []
    const flightMap = new Map(flights.map(f => [f.businessId, f]))
    return routes.flatMap(r => buildRouteLegs(r, flightMap))
  }, [routes, flights])

  // Legs currently in transit at simTime
  const activeLegs = simTime
    ? allLegs
        .filter(leg => leg.salida <= simTime && simTime <= leg.llegada)
        .map(leg => ({ ...leg, progreso: (simTime - leg.salida) / (leg.llegada - leg.salida) }))
    : []

  // Aggregate coincident legs into one dot per origin-destination pair
  const activeDotMap = {}
  activeLegs.forEach(leg => {
    const key = `${leg.desde}-${leg.hasta}`
    if (!activeDotMap[key]) {
      activeDotMap[key] = { desde: leg.desde, hasta: leg.hasta, progreso: leg.progreso, count: 0, maletas: 0 }
    }
    activeDotMap[key].count   += 1
    activeDotMap[key].maletas += leg.cantidadMaletas
  })
  const activeDots = Object.values(activeDotMap)

  // Simulation progress [0, 1] for the progress bar
  const simProgress = simStart && simEnd && simTime
    ? Math.min(1, Math.max(0, (simTime - simStart) / (simEnd - simStart)))
    : 0

  // ── Simulation timer ───────────────────────────────────────────────────────

  useEffect(() => {
    clearInterval(timerRef.current)
    if (!isPlaying || !simEnd) return
    timerRef.current = setInterval(() => {
      setSimTime(t => {
        if (!t) return t
        const next = new Date(t.getTime() + playSpeed * 60 * 1000)
        if (next >= simEnd) { setIsPlaying(false); return new Date(simEnd) }
        return next
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [isPlaying, playSpeed, simEnd])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zoom/pan helpers ───────────────────────────────────────────────────────

  function applyTransform(t) {
    const next = {
      scale: Math.min(Math.max(t.scale, SCALE_MIN), SCALE_MAX),
      tx: t.tx, ty: t.ty,
    }
    transformRef.current = next
    setTransform(next)
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onWheel(e) {
      e.preventDefault()
      const { scale, tx, ty } = transformRef.current
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return
      const cx = (e.clientX - rect.left) / rect.width  * 1000
      const cy = (e.clientY - rect.top)  / rect.height * 500
      const factor   = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const newScale = Math.min(Math.max(scale * factor, SCALE_MIN), SCALE_MAX)
      const ratio    = newScale / scale
      applyTransform({ scale: newScale, tx: cx - (cx - tx) * ratio, ty: cy - (cy - ty) * ratio })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function handleMouseDown(e) {
    if (e.button !== 0) return
    isDragging.current = false
    dragState.current  = { startX: e.clientX, startY: e.clientY, startTx: transformRef.current.tx, startTy: transformRef.current.ty }
  }

  function handleMouseMove(e) {
    setMousePos({ x: e.clientX, y: e.clientY })
    if (!dragState.current) return
    const dx = e.clientX - dragState.current.startX
    const dy = e.clientY - dragState.current.startY
    if (!isDragging.current && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      isDragging.current = true
      setIsPanning(true)
    }
    if (!isDragging.current) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    applyTransform({
      scale: transformRef.current.scale,
      tx:    dragState.current.startTx + dx * 1000 / rect.width,
      ty:    dragState.current.startTy + dy * 500  / rect.height,
    })
  }

  function endDrag() {
    dragState.current = null
    setIsPanning(false)
    setTimeout(() => { isDragging.current = false }, 0)
  }

  function zoomBy(factor) {
    const { scale, tx, ty } = transformRef.current
    const cx = 500, cy = 250
    const newScale = Math.min(Math.max(scale * factor, SCALE_MIN), SCALE_MAX)
    const ratio    = newScale / scale
    applyTransform({ scale: newScale, tx: cx - (cx - tx) * ratio, ty: cy - (cy - ty) * ratio })
  }

  function resetView() { applyTransform(INITIAL_TRANSFORM) }

  // SVG sizing — inversely proportional to zoom so visual size stays constant
  const s       = transform.scale
  const nodeR   = 8   / s
  const nodeSW  = 1.5 / s
  const labelSz = 8   / s
  const labelDy = 13  / s
  const dotR    = 5   / s

  const coords = {}
  Object.values(aeropuertosActivos).forEach(ap => {
    coords[ap.codigo] = pctToXY(ap.mapX, ap.mapY)
  })

  const svgTransform = `translate(${transform.tx},${transform.ty}) scale(${transform.scale})`

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden bg-[#0c1a2e] select-none ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      <svg ref={svgRef} viewBox="0 0 1000 500" className="w-full h-full">
        <rect width="1000" height="500" fill="#0c1a2e" />
        <g transform={svgTransform}>

          {/* Países */}
          <g fill="#1e3a5f" stroke="#0f2744" strokeWidth="0.5">
            {COUNTRY_PATHS.map((d, i) => <path key={i} d={d} />)}
          </g>

          {/* Rutas estáticas (líneas punteadas) */}
          {rutasLineas.map((ruta, i) => {
            const a = coords[ruta.desde]
            const b = coords[ruta.hasta]
            if (!a || !b) return null
            const mx = (a.x + b.x) / 2
            const my = Math.min(a.y, b.y) - 40
            return (
              <path
                key={i}
                d={`M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`}
                fill="none" stroke="#3b82f6" strokeWidth="0.8"
                strokeDasharray="4 3" opacity="0.4"
              />
            )
          })}

          {/* Maletas en tránsito — un punto por par origen-destino activo */}
          {activeDots.map(dot => {
            const a = coords[dot.desde]
            const b = coords[dot.hasta]
            if (!a || !b) return null
            const mx = (a.x + b.x) / 2
            const my = Math.min(a.y, b.y) - 40
            const t  = dot.progreso
            const bx = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x
            const by = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y
            return (
              <g
                key={`${dot.desde}-${dot.hasta}`}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setTooltipDot(dot)}
                onMouseLeave={() => setTooltipDot(null)}
              >
                {/* Halo pulsante */}
                <circle cx={bx} cy={by} r={dotR * 2} fill="#3b82f6" opacity="0.15" />
                {/* Punto principal */}
                <circle cx={bx} cy={by} r={dotR} fill="#3b82f6" stroke="#93c5fd" strokeWidth={nodeSW} />
                {/* Contador si hay más de un envío en este tramo */}
                {dot.count > 1 && (
                  <text
                    x={bx} y={by - dotR - 2 / s}
                    textAnchor="middle" fill="white"
                    fontSize={labelSz * 0.9} fontWeight="700"
                    fontFamily="Inter, sans-serif"
                    style={{ userSelect: 'none' }}
                  >
                    {dot.count}
                  </text>
                )}
              </g>
            )
          })}

          {/* Nodos de aeropuertos */}
          {Object.values(aeropuertosActivos).map(ap => {
            const pos = coords[ap.codigo]
            if (!pos) return null
            const pct   = getOcupacionPct(ap)
            const color = getSemaforoPorOcupacion(pct)
            const hex   = SEMAFORO_COLORES[color]
            return (
              <g
                key={ap.codigo}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setTooltipAeropuerto(ap)}
                onMouseLeave={() => setTooltipAeropuerto(null)}
                onClick={() => { if (isDragging.current) return; navigate(`/aeropuerto/${ap.codigo}`) }}
              >
                <circle cx={pos.x} cy={pos.y} r={nodeR * 1.5} fill={hex} opacity="0.15">
                  <animate attributeName="r" values={`${nodeR * 1.25};${nodeR * 2};${nodeR * 1.25}`} dur="3s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.15;0.05;0.15" dur="3s" repeatCount="indefinite" />
                </circle>
                <circle cx={pos.x} cy={pos.y} r={nodeR} fill={hex} stroke="white" strokeWidth={nodeSW} />
                <text
                  x={pos.x} y={pos.y - labelDy}
                  textAnchor="middle" fill="white"
                  fontSize={labelSz} fontWeight="600"
                  fontFamily="Inter, sans-serif"
                  style={{ userSelect: 'none' }}
                >
                  {ap.codigo}
                </text>
              </g>
            )
          })}

        </g>
      </svg>

      {/* ── Controles de zoom ──────────────────────────────────────────────── */}
      <div
        className="absolute top-3 right-3 flex flex-col gap-1 z-10"
        onMouseDown={e => e.stopPropagation()}
      >
        <ZoomButton label="+" title="Acercar"           onClick={() => zoomBy(ZOOM_FACTOR)} />
        <ZoomButton label="−" title="Alejar"            onClick={() => zoomBy(1 / ZOOM_FACTOR)} />
        <div className="h-px bg-slate-600 my-0.5" />
        <ZoomButton label="↺" title="Restablecer vista" onClick={resetView} />
      </div>

      {/* ── Reproductor de simulación ──────────────────────────────────────── */}
      {simTime && (
        <div
          className="absolute bottom-14 left-4 right-4 z-10"
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="bg-slate-900/92 backdrop-blur border border-slate-700 rounded-xl px-4 py-2.5 flex items-center gap-3">

            {/* Play / Pause */}
            <button
              onClick={() => setIsPlaying(p => !p)}
              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold transition-colors"
              title={isPlaying ? 'Pausar' : 'Reproducir'}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>

            {/* Speed selector */}
            <select
              value={playSpeed}
              onChange={e => setPlaySpeed(Number(e.target.value))}
              className="shrink-0 bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1 cursor-pointer focus:outline-none focus:border-blue-500"
            >
              {SPEED_OPTIONS.map(v => (
                <option key={v} value={v}>{v}×</option>
              ))}
            </select>

            {/* Datetime display */}
            <span className="shrink-0 text-slate-300 text-xs font-mono whitespace-nowrap">
              📅 {formatSimDateTime(simTime)}
            </span>

            {/* Progress bar — clickable to seek */}
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

            {/* Active shipments counter */}
            <span className="shrink-0 text-xs font-mono min-w-[6rem] text-right text-blue-400">
              {activeLegs.length > 0 ? `${activeLegs.length} en vuelo` : 'sin vuelos'}
            </span>

          </div>
        </div>
      )}

      {/* ── Tooltips ───────────────────────────────────────────────────────── */}
      {tooltipAeropuerto && !isPanning && (
        <TooltipAeropuerto ap={tooltipAeropuerto} pos={mousePos} />
      )}
      {tooltipDot && !tooltipAeropuerto && !isPanning && (
        <TooltipDot dot={tooltipDot} pos={mousePos} />
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

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

function TooltipAeropuerto({ ap, pos }) {
  const pct       = getOcupacionPct(ap)
  const color     = getSemaforoPorOcupacion(pct)
  const barColor  = { verde: 'bg-green-500', ambar: 'bg-amber-500', rojo: 'bg-red-500' }[color]
  const textColor = { verde: 'text-green-400', ambar: 'text-amber-400', rojo: 'text-red-400' }[color]
  return (
    <div className="fixed z-50 pointer-events-none" style={{ left: pos.x + 16, top: pos.y - 10 }}>
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl p-3 min-w-[220px]">
        <div className="font-bold text-white text-sm mb-0.5">{ap.nombre}</div>
        <div className="text-slate-400 text-xs mb-2">{ap.ciudad} — {ap.continente}</div>
        <div className="text-xs text-slate-300 mb-1">Ocupación almacén</div>
        <div className={`font-mono font-semibold text-sm mb-1 ${textColor}`}>
          {ap.almacen.actual.toLocaleString()}/{ap.almacen.capacidad.toLocaleString()} maletas ({pct}%)
        </div>
        <div className="w-full bg-slate-700 rounded-full h-1.5 mb-2">
          <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-x-3 text-xs text-slate-400 mb-2">
          <span>Maletas en riesgo</span><span className="text-amber-400 font-mono">{ap.maletasEnRiesgo}</span>
          <span>Vuelos próximos</span> <span className="text-blue-400 font-mono">{ap.vuelosProximos}</span>
          <span>Última actualiz.</span><span className="text-slate-300">{ap.ultimaActualizacion}</span>
        </div>
        <div className="text-blue-400 text-xs">Click para ver detalles →</div>
      </div>
    </div>
  )
}

function TooltipDot({ dot, pos }) {
  return (
    <div className="fixed z-50 pointer-events-none" style={{ left: pos.x + 16, top: pos.y - 10 }}>
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl p-3 min-w-[180px]">
        <div className="font-bold text-white text-sm mb-0.5">{dot.desde} → {dot.hasta}</div>
        <div className="text-slate-400 text-xs mb-2">Envíos en tránsito</div>
        <div className="grid grid-cols-2 gap-x-3 text-xs text-slate-400">
          <span>Envíos</span>  <span className="text-blue-400 font-mono font-bold">{dot.count}</span>
          <span>Maletas</span> <span className="text-blue-400 font-mono font-bold">{dot.maletas.toLocaleString()}</span>
          <span>Progreso</span><span className="text-slate-300 font-mono">{Math.round(dot.progreso * 100)}%</span>
        </div>
      </div>
    </div>
  )
}
