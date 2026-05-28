import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { feature } from 'topojson-client'
import worldData from 'world-atlas/countries-110m.json'
import { AEROPUERTOS, RUTAS, getOcupacionPct, getSemaforoPorOcupacion, SEMAFORO_COLORES } from '../data/aeropuertos'
import { VUELOS_EN_AIRE } from '../data/vuelos'
import BarraProgreso from './BarraProgreso'

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

export default function MapaMundi() {
  const navigate = useNavigate()
  const [tooltipAeropuerto, setTooltipAeropuerto] = useState(null)
  const [tooltipVuelo, setTooltipVuelo] = useState(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const svgRef = useRef(null)

  function handleMouseMove(e) {
    setMousePos({ x: e.clientX, y: e.clientY })
  }

  const coords = {}
  Object.values(AEROPUERTOS).forEach((ap) => {
    coords[ap.codigo] = pctToXY(ap.mapX, ap.mapY)
  })

  return (
    <div
      className="relative w-full h-full overflow-hidden bg-[#0c1a2e]"
      onMouseMove={handleMouseMove}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 1000 500"
        className="relative w-full h-full"
      >
        {/* Océano */}
        <rect width="1000" height="500" fill="#0c1a2e" />

        {/* Países del mundo — topojson countries-110m */}
        <g fill="#1e3a5f" stroke="#0f2744" strokeWidth="0.5">
          {COUNTRY_PATHS.map((d, i) => <path key={i} d={d} />)}
        </g>

        {/* Rutas de vuelo */}
        {RUTAS.map((ruta, i) => {
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
        {VUELOS_EN_AIRE.filter(v => v.progreso > 0).map((vuelo, i) => {
          const a = coords[vuelo.desde]
          const b = coords[vuelo.hasta]
          if (!a || !b) return null
          const mx = (a.x + b.x) / 2
          const my = Math.min(a.y, b.y) - 40
          const t = vuelo.progreso
          const bx = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x
          const by = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y
          const animDelay = `${i * -1.5}s`
          return (
            <g key={vuelo.codigo}>
              <circle
                cx={bx}
                cy={by}
                r="5"
                fill="#3b82f6"
                stroke="#93c5fd"
                strokeWidth="1"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setTooltipVuelo(vuelo)}
                onMouseLeave={() => setTooltipVuelo(null)}
              />
              <circle cx={bx} cy={by} r="5" fill="none" stroke="#93c5fd" strokeWidth="1" opacity="0.5">
                <animate attributeName="r" from="5" to="10" dur="2s" repeatCount="indefinite" begin={animDelay} />
                <animate attributeName="opacity" from="0.6" to="0" dur="2s" repeatCount="indefinite" begin={animDelay} />
              </circle>
            </g>
          )
        })}

        {/* Nodos de aeropuertos */}
        {Object.values(AEROPUERTOS).map((ap) => {
          const pos = coords[ap.codigo]
          const pct = getOcupacionPct(ap)
          const color = getSemaforoPorOcupacion(pct)
          const hex = SEMAFORO_COLORES[color]
          return (
            <g
              key={ap.codigo}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setTooltipAeropuerto(ap)}
              onMouseLeave={() => setTooltipAeropuerto(null)}
              onClick={() => navigate(`/aeropuerto/${ap.codigo}`)}
            >
              <circle cx={pos.x} cy={pos.y} r="12" fill={hex} opacity="0.15">
                <animate attributeName="r" values="10;16;10" dur="3s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.15;0.05;0.15" dur="3s" repeatCount="indefinite" />
              </circle>
              <circle cx={pos.x} cy={pos.y} r="8" fill={hex} stroke="white" strokeWidth="1.5" />
              <text
                x={pos.x}
                y={pos.y - 13}
                textAnchor="middle"
                fill="white"
                fontSize="8"
                fontWeight="600"
                fontFamily="Inter, sans-serif"
                style={{ userSelect: 'none' }}
              >
                {ap.codigo}
              </text>
            </g>
          )
        })}
      </svg>

      {tooltipAeropuerto && (
        <TooltipAeropuerto
          ap={tooltipAeropuerto}
          pos={mousePos}
          onNavegar={() => navigate(`/aeropuerto/${tooltipAeropuerto.codigo}`)}
        />
      )}
      {tooltipVuelo && !tooltipAeropuerto && (
        <TooltipVuelo vuelo={tooltipVuelo} pos={mousePos} />
      )}
    </div>
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
