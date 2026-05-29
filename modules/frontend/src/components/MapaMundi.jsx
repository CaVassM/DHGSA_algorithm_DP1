import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { feature } from 'topojson-client'
import worldData from 'world-atlas/countries-110m.json'
import { AEROPUERTOS, RUTAS, getOcupacionPct, getSemaforoPorOcupacion, SEMAFORO_COLORES } from '../data/aeropuertos'
import BarraProgreso from './BarraProgreso'
import { getAirports, getFlights, getPlanningRunRoutes } from '../services/api'

// ---------------------------------------------------------------------------
// Equirectangular projection → SVG 1000×500
// x = (lon + 180) / 360 * 1000
// y = (90  - lat) / 180 * 500
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

// Pre-compute at module load — static data, runs once
const COUNTRY_PATHS = feature(worldData, worldData.objects.countries)
  .features
  .map(featureToD)
  .filter(Boolean)

// ---------------------------------------------------------------------------
// mapX/mapY percentage → SVG coordinate  (pctToXY mirrors the projection)
// ---------------------------------------------------------------------------
function pctToXY(xPct, yPct) {
  return { x: parseFloat(xPct) * 10, y: parseFloat(yPct) * 5 }
}

// ---------------------------------------------------------------------------
// Helpers para calcular el progreso de vuelos en tiempo real
// ---------------------------------------------------------------------------
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

// Retorna un valor [0,1] si el vuelo está en tránsito ahora, -1 si no.
function calcProgreso(horaSalida, horaLlegada, nowMin) {
  const salidaMin = timeToMinutes(horaSalida)
  let llegadaMin  = timeToMinutes(horaLlegada)
  if (llegadaMin <= salidaMin) llegadaMin += 1440   // cruza medianoche
  let nowAdj = nowMin
  if (llegadaMin > 1440 && nowAdj < salidaMin) nowAdj += 1440
  if (nowAdj < salidaMin || nowAdj > llegadaMin) return -1
  return (nowAdj - salidaMin) / (llegadaMin - salidaMin)
}

function formatDuracion(minutos) {
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ---------------------------------------------------------------------------
// Adaptar AirportResponse del backend al formato interno del mapa.
// Sin dato de ocupación real: actual=0 → semáforo verde por defecto.
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
// Zoom/pan constants
// ---------------------------------------------------------------------------
const SCALE_MIN      = 0.5
const SCALE_MAX      = 8
const ZOOM_FACTOR    = 1.3
const DRAG_THRESHOLD = 4   // px before a mousedown is considered a drag

const INITIAL_TRANSFORM = { scale: 1, tx: 0, ty: 0 }

export default function MapaMundi({ runId, runCompleted = false }) {
  const navigate     = useNavigate()
  const svgRef       = useRef(null)
  const containerRef = useRef(null)

  // ── Tooltip state ─────────────────────────────────────────────────────────
  const [tooltipAeropuerto, setTooltipAeropuerto] = useState(null)
  const [tooltipVuelo, setTooltipVuelo]           = useState(null)
  const [mousePos, setMousePos]                   = useState({ x: 0, y: 0 })

  // ── Data state ────────────────────────────────────────────────────────────
  const [airports, setAirports] = useState(null)
  const [routes,   setRoutes]   = useState(null)
  const [flights,  setFlights]  = useState([])
  const [now,      setNow]      = useState(() => new Date())

  // ── Zoom/pan state ────────────────────────────────────────────────────────
  const [transform, setTransform] = useState(INITIAL_TRANSFORM)
  const [isPanning, setIsPanning] = useState(false)

  // Refs to avoid stale closures in event handlers
  const transformRef = useRef(INITIAL_TRANSFORM)
  const dragState    = useRef(null)   // { startX, startY, startTx, startTy } | null
  const isDragging   = useRef(false)  // true once mouse moves past threshold

  // ── Data effects ──────────────────────────────────────────────────────────

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
        console.log('[MapaMundi] raw response:', list)
        const rutas = Array.from(
          new Map(
            list
              .filter(r => r.origenIcao && r.destinoIcao)
              .map(r => [`${r.origenIcao}-${r.destinoIcao}`, { desde: r.origenIcao, hasta: r.destinoIcao }])
          ).values()
        )
        console.log('[MapaMundi] rutas antes de setRoutes:', rutas)
        setRoutes(rutas)
      })
      .catch(err => console.error('[MapaMundi] fetch rutas fallido:', err))
  // runCompleted como dependencia: re-fetch cuando el run termina y las rutas ya existen
  }, [runId, runCompleted])

  useEffect(() => {
    getFlights(0, 500)
      .then(page => setFlights(page.content ?? []))
      .catch(() => {})
  }, [])

  // Tick cada segundo para redibujar los aviones en su posición actual
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // ── Zoom/pan helpers ──────────────────────────────────────────────────────

  function applyTransform(t) {
    const next = {
      scale: Math.min(Math.max(t.scale, SCALE_MIN), SCALE_MAX),
      tx:    t.tx,
      ty:    t.ty,
    }
    transformRef.current = next
    setTransform(next)
  }

  // Non-passive wheel listener — React cannot set { passive: false } via JSX
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function onWheel(e) {
      e.preventDefault()
      const { scale, tx, ty } = transformRef.current
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return

      // Cursor position in SVG viewBox coordinates
      const cx = (e.clientX - rect.left) / rect.width  * 1000
      const cy = (e.clientY - rect.top)  / rect.height * 500

      const factor   = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const newScale = Math.min(Math.max(scale * factor, SCALE_MIN), SCALE_MAX)
      const ratio    = newScale / scale

      // Keep the point under the cursor fixed after scaling
      applyTransform({ scale: newScale, tx: cx - (cx - tx) * ratio, ty: cy - (cy - ty) * ratio })
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, []) // eslint-disable-line — applyTransform only uses refs and stable setTransform

  function handleMouseDown(e) {
    if (e.button !== 0) return
    isDragging.current = false
    dragState.current  = {
      startX:  e.clientX,
      startY:  e.clientY,
      startTx: transformRef.current.tx,
      startTy: transformRef.current.ty,
    }
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

    // Convert screen-pixel delta to SVG viewBox units
    applyTransform({
      scale: transformRef.current.scale,
      tx:    dragState.current.startTx + dx * 1000 / rect.width,
      ty:    dragState.current.startTy + dy * 500  / rect.height,
    })
  }

  function endDrag() {
    dragState.current = null
    setIsPanning(false)
    // isDragging must remain true until the click event fires (click fires
    // synchronously after mouseup in the same event flush), then reset.
    setTimeout(() => { isDragging.current = false }, 0)
  }

  function zoomBy(factor) {
    const { scale, tx, ty } = transformRef.current
    const cx = 500, cy = 250 // SVG centre
    const newScale = Math.min(Math.max(scale * factor, SCALE_MIN), SCALE_MAX)
    const ratio    = newScale / scale
    applyTransform({ scale: newScale, tx: cx - (cx - tx) * ratio, ty: cy - (cy - ty) * ratio })
  }

  function resetView() {
    applyTransform(INITIAL_TRANSFORM)
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const aeropuertosActivos = airports ?? AEROPUERTOS
  const rutasActivas       = routes ?? (airports ? [] : RUTAS)

  // Vuelos actualmente en tránsito según la hora local
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
  const vuelosEnAire = flights.flatMap(f => {
    const progreso = calcProgreso(f.horaSalida, f.horaLlegada, nowMin)
    if (progreso < 0) return []
    return [{
      codigo:           f.businessId,
      desde:            f.origenIcao,
      hasta:            f.destinoIcao,
      progreso,
      maletasActual:    f.capacidad - f.capacidadDisponible,
      maletasCapacidad: f.capacidad,
      tiempoVuelo:      formatDuracion(f.duracionMinutos),
      horaDespegue:     f.horaSalida,
      horaLlegada:      f.horaLlegada,
      estado:           'En tránsito',
    }]
  })

  console.log('[MapaMundi] render — airports:', Object.keys(aeropuertosActivos).length, '| routes state:', routes?.length ?? 'null', '| rutasActivas:', rutasActivas.length, '| runId:', runId, '| runCompleted:', runCompleted)

  // Tamaños inversamente proporcionales al zoom → tamaño visual constante en pantalla
  const s       = transform.scale
  const nodeR   = 8   / s   // radio del círculo de aeropuerto
  const nodeSW  = 1.5 / s   // grosor de borde del círculo
  const labelSz = 8   / s   // tamaño de fuente de la etiqueta ICAO
  const labelDy = 13  / s   // separación vertical etiqueta↑nodo (en unidades SVG)
  const dotR    = 5   / s   // radio del punto de vuelo en tránsito

  const coords = {}
  Object.values(aeropuertosActivos).forEach((ap) => {
    coords[ap.codigo] = pctToXY(ap.mapX, ap.mapY)
  })

  const svgTransform = `translate(${transform.tx},${transform.ty}) scale(${transform.scale})`

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden bg-[#0c1a2e] select-none ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 1000 500"
        className="w-full h-full"
      >
        {/* Océano — fixed, outside the transform group */}
        <rect width="1000" height="500" fill="#0c1a2e" />

        {/* All map content inside the zoom/pan transform */}
        <g transform={svgTransform}>

          {/* Países del mundo — topojson countries-110m */}
          <g fill="#1e3a5f" stroke="#0f2744" strokeWidth="0.5">
            {COUNTRY_PATHS.map((d, i) => <path key={i} d={d} />)}
          </g>

          {/* Rutas de vuelo */}
          {rutasActivas.map((ruta, i) => {
            const a = coords[ruta.desde]
            const b = coords[ruta.hasta]
            if (!a || !b) return null
            const mx = (a.x + b.x) / 2
            const my = Math.min(a.y, b.y) - 40
            return (
              <path
                key={i}
                d={`M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`}
                fill="none"
                stroke="#3b82f6"
                strokeWidth="0.8"
                strokeDasharray="4 3"
                opacity="0.4"
              />
            )
          })}

          {/* Puntos de vuelo animados */}
          {vuelosEnAire.map((vuelo, i) => {
            const a = coords[vuelo.desde]
            const b = coords[vuelo.hasta]
            if (!a || !b) return null
            const mx = (a.x + b.x) / 2
            const my = Math.min(a.y, b.y) - 40
            const t  = vuelo.progreso
            const bx = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x
            const by = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y
            const animDelay = `${i * -1.5}s`
            return (
              <g key={vuelo.codigo}>
                <circle
                  cx={bx} cy={by} r={dotR}
                  fill="#3b82f6" stroke="#93c5fd" strokeWidth={nodeSW}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setTooltipVuelo(vuelo)}
                  onMouseLeave={() => setTooltipVuelo(null)}
                />
                <circle cx={bx} cy={by} r={dotR} fill="none" stroke="#93c5fd" strokeWidth={nodeSW} opacity="0.5">
                  <animate attributeName="r" from={dotR} to={dotR * 2} dur="2s" repeatCount="indefinite" begin={animDelay} />
                  <animate attributeName="opacity" from="0.6" to="0" dur="2s" repeatCount="indefinite" begin={animDelay} />
                </circle>
              </g>
            )
          })}

          {/* Nodos de aeropuertos */}
          {Object.values(aeropuertosActivos).map((ap) => {
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
                onClick={() => {
                  if (isDragging.current) return
                  navigate(`/aeropuerto/${ap.codigo}`)
                }}
              >
                <circle cx={pos.x} cy={pos.y} r={nodeR * 1.5} fill={hex} opacity="0.15">
                  <animate attributeName="r" values={`${nodeR * 1.25};${nodeR * 2};${nodeR * 1.25}`} dur="3s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.15;0.05;0.15" dur="3s" repeatCount="indefinite" />
                </circle>
                <circle cx={pos.x} cy={pos.y} r={nodeR} fill={hex} stroke="white" strokeWidth={nodeSW} />
                <text
                  x={pos.x} y={pos.y - labelDy}
                  textAnchor="middle"
                  fill="white" fontSize={labelSz} fontWeight="600"
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

      {/* ── Controles de zoom ─────────────────────────────────────────────── */}
      <div
        className="absolute top-3 right-3 flex flex-col gap-1 z-10"
        onMouseDown={e => e.stopPropagation()}  // no inicia pan al usar los botones
      >
        <ZoomButton label="+" title="Acercar"        onClick={() => zoomBy(ZOOM_FACTOR)} />
        <ZoomButton label="−" title="Alejar"         onClick={() => zoomBy(1 / ZOOM_FACTOR)} />
        <div className="h-px bg-slate-600 my-0.5" />
        <ZoomButton label="↺" title="Restablecer vista" onClick={resetView} />
      </div>

      {/* ── Tooltips (ocultos mientras se arrastra) ───────────────────────── */}
      {tooltipAeropuerto && !isPanning && (
        <TooltipAeropuerto
          ap={tooltipAeropuerto}
          pos={mousePos}
          onNavegar={() => navigate(`/aeropuerto/${tooltipAeropuerto.codigo}`)}
        />
      )}
      {tooltipVuelo && !tooltipAeropuerto && !isPanning && (
        <TooltipVuelo vuelo={tooltipVuelo} pos={mousePos} />
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
  const pct = getOcupacionPct(ap)
  const color = getSemaforoPorOcupacion(pct)
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
          <span>Vuelos próximos</span><span className="text-blue-400 font-mono">{ap.vuelosProximos}</span>
          <span>Última actualiz.</span><span className="text-slate-300">{ap.ultimaActualizacion}</span>
        </div>
        <div className="text-blue-400 text-xs">Click para ver detalles →</div>
      </div>
    </div>
  )
}

function TooltipVuelo({ vuelo, pos }) {
  const pct = Math.round((vuelo.maletasActual / vuelo.maletasCapacidad) * 100)
  const color = pct > 100 ? 'text-red-400' : pct >= 85 ? 'text-amber-400' : 'text-green-400'
  return (
    <div className="fixed z-50 pointer-events-none" style={{ left: pos.x + 16, top: pos.y - 10 }}>
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl p-3 min-w-[200px]">
        <div className="font-bold text-white text-sm mb-0.5">{vuelo.codigo}</div>
        <div className="text-slate-400 text-xs mb-2">Ruta: {vuelo.desde} → {vuelo.hasta}</div>
        <div className={`font-mono font-semibold text-sm mb-2 ${color}`}>
          {vuelo.maletasActual}/{vuelo.maletasCapacidad} ({pct}%)
        </div>
        <div className="grid grid-cols-2 gap-x-3 text-xs text-slate-400">
          <span>Duración</span><span className="text-slate-300">{vuelo.tiempoVuelo}</span>
          <span>Despegue</span><span className="text-slate-300">{vuelo.horaDespegue}</span>
          <span>Llegada est.</span><span className="text-slate-300">{vuelo.horaLlegada}</span>
          <span>Estado</span><span className="text-blue-400">{vuelo.estado}</span>
        </div>
      </div>
    </div>
  )
}
