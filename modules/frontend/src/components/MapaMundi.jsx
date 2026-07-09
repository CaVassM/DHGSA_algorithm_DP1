import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MapContainer,
  TileLayer,
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

// Respiro entre bloques (ms): al terminar los vuelos de una época y llegar la
// siguiente, la reproducción espera este instante antes de reanudar, para que la
// transición entre épocas se perciba (petición explícita: pausa "natural" de
// unos segundos entre bloques).
const RESPIRO_MS = 3000

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

// T4: tiempo real transcurrido (reloj de pared), en h:mm:ss / mm:ss.
function formatElapsedReal(ms) {
  if (ms == null || ms < 0) return '--:--'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const p = n => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`
}

function getPlaneColors(pct) {
  if (pct <= UMBRALES_ALMACEN.vacio) return { fill: '#94a3b8', stroke: '#cbd5e1' }
  if (pct > 85) return { fill: '#f87171', stroke: '#fecaca' }
  if (pct >= 60) return { fill: '#fbbf24', stroke: '#fde68a' }
  return { fill: '#4ade80', stroke: '#bbf7d0' }
}

// T55: color-nombre del semáforo de una UT (avión) según su % de ocupación.
function getPlaneSemaforo(pct) {
  if (pct <= UMBRALES_ALMACEN.vacio) return 'vacio'
  if (pct > 85) return 'rojo'
  if (pct >= 60) return 'ambar'
  return 'verde'
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

// T6: ícono de aeropuerto (en vez de un círculo). El color del semáforo va en
// el relleno; el borde blanco lo mantiene legible sobre el mapa oscuro.
function createAirportIcon({ fill, atenuado = false }) {
  return L.divIcon({
    className: 'tasf-airport-icon-wrapper',
    html: `
      <div class="tasf-airport-icon" style="--ap-fill:${fill};opacity:${atenuado ? 0.3 : 1};">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="${fill}" stroke="#ffffff" stroke-width="2"/>
          <path fill="#0f172a" transform="translate(4.6 4.6) scale(0.62)"
            d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>
        </svg>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
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
  // El profesor pidió que TODOS los aeropuertos ocupen el máximo espacio
  // posible en el eje vertical (Montevideo/Argentina abajo ↔ Copenhague
  // arriba), en un solo pantallazo. El eje vertical es el crítico; en el
  // horizontal sobra espacio. Por eso usamos padding ASIMÉTRICO: poco margen
  // vertical (los aeropuertos extremos quedan pegados a los bordes, pero con
  // unos px para que íconos/labels no se "caigan") y más margen horizontal.
  //   [top, left] y [bottom, right]
  map.fitBounds(bounds, {
    paddingTopLeft: [56, 16],
    paddingBottomRight: [56, 16],
    maxZoom: 6,
  })
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

//se agrega esto nuevo
function adaptLiveRouteToMapRoute(route) {
  if (!route) return null

  return {
    origenIcao:
      route.origenIcao ??
      route.originIcao ??
      route.origen ??
      route.origin,

    destinoIcao:
      route.destinoIcao ??
      route.destinationIcao ??
      route.destino ??
      route.destination,

    tiempoInicio:
      route.tiempoInicio ??
      route.startTime ??
      route.inicio,

    tiempoLlegadaEstimado:
      route.tiempoLlegadaEstimado ??
      route.estimatedArrivalTime ??
      route.llegadaEstimada ??
      route.fin,

    distanciaTotal:
      route.distanciaTotal ??
      route.totalDistance,

    esDirecta:
      route.esDirecta ??
      route.directa ??
      route.direct,

    escalas:
      route.escalas ??
      route.stops ??
      0,

    shipmentBusinessId:
      route.shipmentBusinessId ??
      route.envioId ??
      route.shipmentId ??
      route.idEnvio,

    cantidadMaletas:
      route.cantidadMaletas ??
      route.totalBags ??
      route.maletas ??
      0,

    flightBusinessIds:
      route.flightBusinessIds ??
      route.vuelos?.map(v => {
        const id = v.businessId ?? v.id
        return id && String(id).includes('@')
          ? String(id).substring(0, String(id).indexOf('@'))
          : id
      }) ??
      route.legs?.map(l => l.flightBusinessId ?? l.flightId ?? l.businessId).filter(Boolean) ??
      [],
  }
} 

export default function MapaMundi({
  runId,
  runCompleted = false,
  liveMode = false,
  liveEvent = null,
  multiplicador = 240,
  epochHours = 4,
  routesRefreshKey = 0,
  onActiveLegsChange,
  onOcupacionChange,
  focusAirport,
  highlightShipment,
  onSelectAirportFromMap,
}) {
  const navigate = useNavigate()
  const timerRef = useRef(null)

  const [airports, setAirports] = useState(null)
  const [routes, setRoutes] = useState(null)
  const [persistedRoutes, setPersistedRoutes] = useState(null)
  const [flights, setFlights] = useState([])

  const [simTime, setSimTime] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  // Velocidad de reproducción (minutos simulados avanzados por tick de 1s).
  //
  // En modo NO-live (run terminado): fija, la semana corre sola.
  //
  // En modo LIVE: DINÁMICA. El backend tarda un tiempo VARIABLE en resolver y
  // mandar cada época (IALNS + persistencia), casi siempre más de lo que el front
  // tardaría a velocidad fija → la animación terminaba antes y la barra se quedaba
  // estática y luego saltaba. Para evitarlo medimos el tiempo real que tardó en
  // llegar la última época y ajustamos la velocidad para que la animación de la
  // época actual dure aprox eso: barra continua, sin saltos ni esperas.
  // livePlaySpeed = (min simulados por época) / (segundos reales objetivo), porque
  // el tick es de 1s. Arranca con una estimación desde el multiplicador y se va
  // recalibrando con cada época que llega.
  const estimacionInicial = Math.max(1, (multiplicador / 60))
  const [livePlaySpeed, setLivePlaySpeed] = useState(estimacionInicial)
  const playSpeed = liveMode ? livePlaySpeed : 60
  // Marca de tiempo real (ms) en que llegó la última época, para medir el intervalo.
  const ultimaEpocaLlegadaRef = useRef(null)

  const [realTime, setRealTime] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setRealTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // T4: marca de inicio real de la operación (primera vez que se da play).
  // Permite mostrar el tiempo REAL transcurrido desde que arrancó la corrida.
  const [inicioReal, setInicioReal] = useState(null)
  useEffect(() => {
    if (isPlaying && !inicioReal) setInicioReal(new Date())
  }, [isPlaying, inicioReal])

  const [mapInstance, setMapInstance] = useState(null)
  const [resetNonce, setResetNonce] = useState(0)

  // T45/T47: envío resaltado por búsqueda. T49: aeropuerto enfocado.
  const [envioBuscado, setEnvioBuscado] = useState('')
  const [busquedaInput, setBusquedaInput] = useState('')
  const [airportInput, setAirportInput] = useState('')

  // T54/T55: filtros por color de semáforo (almacenes y UT). null = todos visibles.
  // Set de colores ocultos; si un color está en el set, se atenúan en el mapa.
  const [almacenesOcultos, setAlmacenesOcultos] = useState(() => new Set())
  const [utsOcultas, setUtsOcultas] = useState(() => new Set())
  // Filtro por continente (multiselección): set de continentes ocultos. Al
  // ocultar un continente, sus aeropuertos Y los vuelos hacia/desde ellos se
  // ocultan (regla del profesor: filtrar aeropuertos oculta sus vuelos).
  const [continentesOcultos, setContinentesOcultos] = useState(() => new Set())

  // T50: aeropuerto seleccionado para ver su detalle en panel (misma vista).
  const [almacenSeleccionado, setAlmacenSeleccionado] = useState(null)

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

/*   useEffect(() => {
    if (!runId) return
    let vivo = true
    getPlanningRunRoutes(runId)
      .then(list => {
        if (!vivo) return
        const valid = list.filter(r => r.origenIcao && r.destinoIcao)
        setRoutes(valid)
        // Inicializar el reloj SOLO si aún no hay simTime. Antes esto corría
        // también cuando el run pasaba a completado (runCompleted cambia), y
        // reseteaba el reproductor al inicio en plena reproducción.
        const starts = valid.map(r => r.tiempoInicio).filter(Boolean).sort()
        if (starts.length > 0) setSimTime(prev => prev ?? new Date(starts[0]))
      })
      .catch(() => {})
    return () => { vivo = false }
  }, [runId, runCompleted]) */
  useEffect(() => {
    if (!runId) return
    let vivo = true

    getPlanningRunRoutes(runId)
      .then(list => {
        if (!vivo) return

        const valid = (list ?? []).filter(r => r.origenIcao && r.destinoIcao)

        setRoutes(valid)

        const starts = valid.map(r => r.tiempoInicio).filter(Boolean).sort()
        if (starts.length > 0) {
          setSimTime(prev => prev ?? new Date(starts[0]))
        }
      })
      .catch(() => {})

    return () => { vivo = false }
}, [runId, runCompleted, routesRefreshKey])

/*   const routes = useMemo(() => {
    if (liveMode && liveRoutes && liveRoutes.length > 0) {
      return liveRoutes
        .map(adaptLiveRouteToMapRoute)
        .filter(r => r && r.origenIcao && r.destinoIcao)
    }

    return persistedRoutes
  }, [liveMode, liveRoutes, persistedRoutes]) */

  // --- Reproducción en vivo: seguir el ritmo del backend ---
  //
  // Techo simulado: hasta dónde puede avanzar la animación. Es el fin de la
  // ÚLTIMA época recibida. El loop de play nunca pasa de aquí; cuando lo alcanza
  // y aún no llegó la siguiente época, se queda esperando (respiro entre bloques).
  // Es ESTADO (no ref) a propósito: el loop de reproducción depende de él, y al
  // ser estado su cambio re-arma el loop de forma fiable (con un ref el arranque
  // quedaba a merced de un re-render externo — por eso "solo arrancaba al mover
  // el cursor").
  const [liveCeiling, setLiveCeiling] = useState(null)
  // Ventana e índice de la época en curso, para medir el progreso por ÉPOCAS en
  // modo vivo (ver simProgress). En vivo NO sirve medir el progreso contra un
  // simEnd derivado de las rutas persistidas: ese fin se aleja cada vez que llega
  // una época nueva, así que la barra parecía estancada. El progreso por épocas
  // (completas + fracción del reloj dentro de la actual) sí avanza monótono.
  const [liveEpocaInfo, setLiveEpocaInfo] = useState(null) // { num, total, inicio, fin }
  // Nº de la última época ya "consumida" para arrancar/reanudar la reproducción.
  const lastLiveEpochRef = useRef(0)
  // Timeout del "respiro" entre bloques, para poder cancelarlo si el componente
  // se desmonta o arranca otra simulación antes de que dispare.
  const respiroTimeoutRef = useRef(null)
  // El usuario pausó a propósito: mientras esté activo, el auto-reanudar (respiro
  // al llegar una época nueva) NO debe volver a poner play. Sin esto, pausar y
  // que llegue una época te "re-pausaba"/"re-arrancaba" peleando con tu intención.
  const pausaManualRef = useRef(false)

  // Nueva simulación (cambia el runId): reiniciar TODO el seguimiento en vivo. Sin
  // esto, al arrancar una segunda simulación el Dashboard se reusa (misma ruta) y
  // el reloj/estado de la corrida anterior quedaba pegado → la nueva no animaba.
  useEffect(() => {
    setLiveCeiling(null)
    setLiveEpocaInfo(null)
    lastLiveEpochRef.current = 0
    setSimTime(null)
    setIsPlaying(false)
    pausaManualRef.current = false
    ultimaEpocaLlegadaRef.current = null
    setLivePlaySpeed(estimacionInicial)
    if (respiroTimeoutRef.current) window.clearTimeout(respiroTimeoutRef.current)
    return () => {
      if (respiroTimeoutRef.current) window.clearTimeout(respiroTimeoutRef.current)
    }
  }, [runId])

  useEffect(() => {
    if (!liveMode || liveEvent?.tipo !== 'EPOCA') return
    const numEpoca = liveEvent.numeroEpoca ?? 0
    if (numEpoca === lastLiveEpochRef.current) return // ya procesada
    lastLiveEpochRef.current = numEpoca

    const inicio = liveEvent.inicioEpoca ? new Date(liveEvent.inicioEpoca) : null
    const fin = liveEvent.finEpoca
      ? new Date(liveEvent.finEpoca)
      : (liveEvent.relojSimulado ? new Date(liveEvent.relojSimulado) : null)

    // Nuevo techo: hasta el fin de esta época puede avanzar la animación.
    if (fin && !Number.isNaN(fin.getTime())) setLiveCeiling(fin)

    // --- Ajuste dinámico de velocidad ---
    // Medimos cuánto tardó (real) en llegar esta época desde la anterior. Ese es
    // el ritmo real del backend. Ajustamos la velocidad para que la animación de
    // la SIGUIENTE ventana dure aprox lo mismo → la barra sube continua en vez de
    // terminar antes y quedarse estática esperando el salto.
    const ahora = Date.now()
    if (inicio && fin && fin > inicio && ultimaEpocaLlegadaRef.current != null) {
      const intervaloRealMs = ahora - ultimaEpocaLlegadaRef.current
      const minutosSimEpoca = (fin - inicio) / 60000 // ms simulados → min
      // Descartar intervalos anómalos: si el usuario cambió de pestaña, el navegador
      // congela los timers y este intervalo sale enorme (minutos). Recalibrar con
      // ese dato basura hundía la velocidad a ~0 y la simulación parecía pausada.
      // Solo recalibramos con intervalos "normales" (0.5s a 3min).
      const INTERVALO_MAX_MS = 180000
      if (intervaloRealMs > 500 && intervaloRealMs < INTERVALO_MAX_MS && minutosSimEpoca > 0) {
        const intervaloSeg = (intervaloRealMs / 1000) * 0.95
        const nuevaVel = minutosSimEpoca / intervaloSeg // min simulados por tick de 1s
        // Suavizado (media móvil) + clamp a un rango sano para que ni un intervalo
        // atípico ni un cálculo raro dejen la velocidad demasiado lenta o rápida.
        setLivePlaySpeed(prev => {
          const mezcla = prev * 0.4 + nuevaVel * 0.6
          return Math.min(240, Math.max(1, mezcla))
        })
      }
    }
    ultimaEpocaLlegadaRef.current = ahora

    // Ventana de la época en curso, para el progreso por épocas de la barra.
    setLiveEpocaInfo({
      num: numEpoca,
      total: liveEvent.totalEpocas ?? 0,
      inicio: inicio && !Number.isNaN(inicio.getTime()) ? inicio : null,
      fin: fin && !Number.isNaN(fin.getTime()) ? fin : null,
    })

    // Primera época: posicionar el reloj al INICIO (no al fin — así la época se
    // ANIMA de principio a fin en vez de saltar) y arrancar solo, sin play manual.
    if (numEpoca <= 1) {
      if (inicio && !Number.isNaN(inicio.getTime())) setSimTime(inicio)
      setIsPlaying(true)
      return
    }

    // Épocas siguientes: NO saltar el reloj. Si la reproducción estaba en pausa
    // porque terminó los vuelos de la época anterior y esperaba, reanudar tras un
    // breve respiro. Pero si el usuario pausó A PROPÓSITO, respetarlo: no reanudar.
    setIsPlaying(prev => {
      if (prev) return prev
      if (pausaManualRef.current) return prev // el usuario quiere estar en pausa
      if (respiroTimeoutRef.current) window.clearTimeout(respiroTimeoutRef.current)
      respiroTimeoutRef.current = window.setTimeout(() => {
        if (!pausaManualRef.current) setIsPlaying(true)
      }, RESPIRO_MS)
      return prev
    })
  }, [liveMode, liveEvent])


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

  // T45/T47: tramos (pares desde-hasta) que pertenecen al envío buscado.
  // Si hay búsqueda activa, las demás rutas se atenúan. El match es tolerante a
  // los ceros de relleno del ID (los IDs en BD vienen como "000000028"): buscar
  // "28", "028" o "000000028" encuentra el mismo envío.
  const tramosEnvioBuscado = useMemo(() => {
    if (!envioBuscado) return null
    const objetivo = normalizarId(envioBuscado)
    const set = new Set()
    allLegs
      .filter(l => normalizarId(l.shipmentId) === objetivo)
      .forEach(l => set.add(`${l.desde}-${l.hasta}`))
    return set
  }, [envioBuscado, allLegs])

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

  // Reportar la ocupación por aeropuerto al padre (Dashboard → PanelListas),
  // para que las listas muestren el semáforo de carga real del instante.
  // Solo emite cuando cambia (firma textual) para no entrar en bucle de renders.
  const lastOcupRef = useRef('')
  useEffect(() => {
    if (!onOcupacionChange) return
    const sig = JSON.stringify(almacenOcupacion)
    if (sig === lastOcupRef.current) return
    lastOcupRef.current = sig
    onOcupacionChange(almacenOcupacion)
  }, [almacenOcupacion, onOcupacionChange])

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

  // Conjunto de ICAOs ocultos: por color de almacén filtrado o por continente
  // filtrado. Se usa para atenuar tanto el aeropuerto como sus vuelos.
  const icaosOcultos = useMemo(() => {
    const set = new Set()
    Object.values(aeropuertosConOcupacion).forEach(ap => {
      const pct = getOcupacionPct(ap)
      const colorOculto = almacenesOcultos.has(getSemaforoPorOcupacion(pct))
      const contOculto = continentesOcultos.has(ap.continente)
      if (colorOculto || contOculto) set.add(ap.codigo)
    })
    return set
  }, [aeropuertosConOcupacion, almacenesOcultos, continentesOcultos])

  // Lista de continentes presentes en el dataset (para el filtro).
  const continentes = useMemo(
    () => Array.from(new Set(Object.values(aeropuertosConOcupacion).map(ap => ap.continente).filter(Boolean))).sort(),
    [aeropuertosConOcupacion],
  )

  // T50: detalle del almacén seleccionado (entran/salen) derivado de las rutas.
  // Definido aquí (después de aeropuertosConOcupacion) para no usarlo antes de
  // su inicialización.
  const detalleAlmacen = useMemo(() => {
    if (!almacenSeleccionado) return null
    const ap = aeropuertosConOcupacion[almacenSeleccionado] ?? aeropuertosActivos[almacenSeleccionado]
    let entran = 0, salen = 0, maletasEntran = 0, maletasSalen = 0
    const flightMap = new Map(flights.map(f => [f.businessId, f]))
    for (const r of (routes ?? [])) {
      const legs = (r.flightBusinessIds ?? []).map(fid => flightMap.get(fid)).filter(Boolean)
      if (legs.some(l => l.destinoIcao === almacenSeleccionado)) { entran++; maletasEntran += r.cantidadMaletas ?? 0 }
      if (legs.some(l => l.origenIcao === almacenSeleccionado)) { salen++; maletasSalen += r.cantidadMaletas ?? 0 }
    }
    return { ap, entran, salen, maletasEntran, maletasSalen }
  }, [almacenSeleccionado, routes, flights, aeropuertosConOcupacion, aeropuertosActivos])

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

    // revealAt = primera salida del tramo (cuándo aparece la línea).
    // hideAt   = última llegada del tramo (cuándo dejar de dibujarla). T9.
    const map = {}
    allLegs.forEach(leg => {
      const key = `${leg.desde}-${leg.hasta}`
      if (!map[key]) {
        map[key] = { desde: leg.desde, hasta: leg.hasta, revealAt: leg.salida, hideAt: leg.llegada }
      } else {
        if (leg.salida < map[key].revealAt) map[key].revealAt = leg.salida
        if (leg.llegada > map[key].hideAt) map[key].hideAt = leg.llegada
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

  // T41: reportar al padre (Dashboard) los envíos actualmente en vuelo, para
  // mostrarlos como lista. Solo emite cuando el conjunto realmente cambia
  // (comparando una firma estable) para no entrar en bucle de renders.
  const enVueloPayload = useMemo(
    () => activeLegs.map(l => ({
      shipmentId: l.shipmentId,
      desde: l.desde,
      hasta: l.hasta,
      maletas: l.cantidadMaletas,
      progreso: l.progreso,
    })),
    // activeLegs se recalcula cada render; dependemos de su firma textual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(activeLegs.map(l => `${l.shipmentId}|${l.desde}|${l.hasta}|${Math.round((l.progreso ?? 0) * 100)}`))],
  )
  const lastPayloadRef = useRef('')
  useEffect(() => {
    if (!onActiveLegsChange) return
    const sig = JSON.stringify(enVueloPayload)
    if (sig === lastPayloadRef.current) return
    lastPayloadRef.current = sig
    onActiveLegsChange(enVueloPayload)
  }, [enVueloPayload, onActiveLegsChange])

  // Progreso de la barra. En vivo se mide por ÉPOCAS (monótono y estable): épocas
  // ya completadas + la fracción del reloj dentro de la época en curso, sobre el
  // total. Así la barra avanza pareja desde el arranque en vez de parecer
  // estancada porque el simEnd (fin de rutas) se aleja al llegar cada época.
  // Fuera de vivo se mide por tiempo simulado contra el fin global de las rutas.
  const simProgress = (() => {
    if (liveMode && liveEpocaInfo && liveEpocaInfo.total > 0) {
      // En vivo: (épocas YA terminadas + fracción de la actual) / total. Con la
      // época 1 recién llegando, terminadas = 0, así que la barra ARRANCA EN 0% y
      // sube conforme el reloj recorre la ventana de la época; al completar la
      // época N la barra vale N/total.
      const { num, total, inicio, fin } = liveEpocaInfo
      let fraccion = 1 // si no hay ventana, contamos la época como completa
      if (inicio && fin && simTime && fin > inicio) {
        fraccion = Math.min(1, Math.max(0, (simTime - inicio) / (fin - inicio)))
      }
      return Math.min(1, Math.max(0, ((num - 1) + fraccion) / total))
    }
    return simStart && simEnd && simTime
      ? Math.min(1, Math.max(0, (simTime - simStart) / (simEnd - simStart)))
      : 0
  })()

  useEffect(() => {
    clearInterval(timerRef.current)
    // En vivo el tope efectivo es el fin de la ÚLTIMA época recibida (techo), no
    // el fin global de las rutas persistidas: no queremos animar más allá de lo
    // que el backend ya resolvió. Fuera de vivo, el tope es simEnd.
    const limite = liveMode ? liveCeiling : simEnd
    if (!isPlaying || !limite) return

    // Avanzamos el reloj según el tiempo REAL transcurrido entre ticks, no un
    // paso fijo. Así, si el navegador ralentiza los timers (cambiar de pestaña),
    // no se acumulan ticks que luego disparan un "avance rápido" de golpe.
    let ultimoTickMs = Date.now()
    timerRef.current = setInterval(() => {
      const ahoraMs = Date.now()
      // Delta real en segundos, CAPADO a 2s: si el tick se retrasó mucho (pestaña
      // en background), no saltamos el reloj — avanzamos lo normal y seguimos.
      const deltaSeg = Math.min(2, (ahoraMs - ultimoTickMs) / 1000)
      ultimoTickMs = ahoraMs
      setSimTime(t => {
        // Primer tick tras arrancar: si simTime aún no está fijado, no avanzamos
        // (esperamos a que la primera época lo posicione). Evita quedarse colgado.
        if (!t) return t
        // playSpeed = min simulados por segundo real → escalamos por el delta real.
        const next = new Date(t.getTime() + playSpeed * 60 * 1000 * deltaSeg)
        if (next >= limite) {
          // Alcanzado el fin de lo disponible.
          if (liveMode) {
            // En vivo NO apagamos el play: simplemente clavamos el reloj en el
            // techo y esperamos a que la siguiente época lo suba (entonces el
            // reloj vuelve a avanzar SOLO). Si aquí hiciéramos setIsPlaying(false),
            // al darle play manual el loop volvería a toparse con el techo y se
            // re-pausaría al instante — justo el bug de "despauso y se pausa solo".
            return new Date(limite)
          }
          // Fuera de vivo, el techo (simEnd) SÍ es el final de la reproducción.
          setIsPlaying(false)
          return new Date(limite)
        }
        return next
      })
    }, 1000)

    return () => clearInterval(timerRef.current)
  }, [isPlaying, playSpeed, simEnd, liveMode, liveCeiling])

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

  // T49: centra el mapa en un aeropuerto (por ICAO) y lo deja enfocado.
  function enfocarAeropuerto(icaoRaw) {
    const icaoBusq = (icaoRaw || '').trim().toUpperCase()
    if (!icaoBusq || !mapInstance) return
    const c = coords[icaoBusq]
    if (!c) return
    mapInstance.flyTo([c.lat, c.lng], Math.max(mapInstance.getZoom(), 5), { duration: 0.8 })
  }

  // T45/T47: aplica/limpia la búsqueda de envío.
  // P11 (hoja P&R): la BÚSQUEDA es temporal — resalta sin ocultar nada y, al
  // terminar, se regresa al estado anterior. Por eso limpiarBusqueda() revierte
  // por completo el resaltado (no es un filtro semi-permanente).
  function buscarEnvio() {
    setEnvioBuscado(busquedaInput.trim())
  }
  function limpiarBusqueda() {
    setBusquedaInput('')
    setEnvioBuscado('')
  }

  // P11: poder salir de la búsqueda con Escape (gesto estándar para "volver al
  // estado anterior"). Solo actúa si hay una búsqueda de envío activa.
  useEffect(() => {
    if (!envioBuscado) return
    const onKey = (e) => { if (e.key === 'Escape') limpiarBusqueda() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [envioBuscado])

  // Vinculación panel→mapa: al seleccionar un aeropuerto en la lista, enfocarlo
  // en el mapa. (focusAirport = { icao, nonce } — el nonce permite re-enfocar
  // aunque se seleccione el mismo aeropuerto dos veces seguidas.)
  //
  // Debe reaccionar SOLO cuando cambia focusAirport (la intención del usuario),
  // no en cada tick del play. `coords` cambia con la ocupación en cada tick, así
  // que se lee por ref para NO ponerlo como dependencia: si estuviera, el efecto
  // se re-ejecutaría con el focusAirport viejo y reabriría el detalle del almacén
  // una y otra vez al darle play.
  const coordsRef = useRef(coords)
  useEffect(() => { coordsRef.current = coords }, [coords])
  useEffect(() => {
    if (!focusAirport?.icao || !mapInstance) return
    const c = coordsRef.current[focusAirport.icao.toUpperCase()]
    if (!c) return
    mapInstance.flyTo([c.lat, c.lng], Math.max(mapInstance.getZoom(), 5), { duration: 0.8 })
    setAirportInput(focusAirport.icao.toUpperCase())
    setAlmacenSeleccionado(focusAirport.icao.toUpperCase())
  }, [focusAirport, mapInstance])

  // Vinculación panel→mapa: al seleccionar un envío en la lista, resaltar su
  // ruta en el mapa (mismo mecanismo que la búsqueda manual de envío).
  useEffect(() => {
    if (!highlightShipment?.id) return
    setBusquedaInput(String(highlightShipment.id))
    setEnvioBuscado(String(highlightShipment.id))
  }, [highlightShipment])

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
          noWrap={true}
        />

        {rutasLineas
          .filter(r => tramosEnvioBuscado?.has(`${r.desde}-${r.hasta}`)
            || !r.revealAt || !simTime || simTime >= r.revealAt)
          .map(ruta => {
            const a = coords[ruta.desde]
            const b = coords[ruta.hasta]
            if (!a || !b) return null
            // T9: tras la llegada (hideAt) el tramo ya se recorrió → se atenúa
            // en vez de quedar dibujado fuerte para siempre y acumularse.
            const recorrida = ruta.hideAt && simTime && simTime > ruta.hideAt
            // T45/T47: si hay envío buscado, resaltar sus tramos y atenuar el resto.
            const key = `${ruta.desde}-${ruta.hasta}`
            const esDelEnvio = tramosEnvioBuscado?.has(key)
            // Regla del profesor: si el origen o destino del tramo está filtrado
            // (aeropuerto oculto por color/continente), atenuar también la ruta.
            const tramoOculto = icaosOcultos.has(ruta.desde) || icaosOcultos.has(ruta.hasta)
            let pathOptions
            if (tramosEnvioBuscado) {
              pathOptions = esDelEnvio
                ? { color: '#facc15', weight: 4, opacity: 0.95 }                 // resaltado
                : { color: '#475569', weight: 1, opacity: 0.1, dashArray: '2 8' } // atenuado
            } else if (tramoOculto) {
              pathOptions = { color: '#475569', weight: 1, opacity: 0.08, dashArray: '2 8' }
            } else if (recorrida) {
              pathOptions = { color: '#475569', weight: 1, opacity: 0.18, dashArray: '2 8' }
            } else {
              pathOptions = { color: '#3b82f6', weight: 2, opacity: 0.5, dashArray: '6 6' }
            }
            return (
              <Polyline
                key={key}
                positions={[[a.lat, a.lng], [b.lat, b.lng]]}
                pathOptions={pathOptions}
              />
            )
          })}

        {activeDots.map(dot => {
          const a = coords[dot.desde]
          const b = coords[dot.hasta]
          if (!a || !b) return null

          const t = dot.progreso
          // El avión debe ir SOBRE la línea de ruta. La Polyline de Leaflet se
          // dibuja recta en PÍXELES de pantalla (proyección), mientras que
          // interpolar en grados lat/lng se curva al proyectar a Mercator → el
          // avión se salía de su ruta. Interpolamos en el mismo espacio que dibuja
          // la línea: proyectamos ambos extremos a puntos de capa, interpolamos
          // ahí y desproyectamos. Así el avión queda clavado sobre la Polyline.
          // Posición por defecto: interpolación lineal en grados.
          let lat = a.lat + (b.lat - a.lat) * t
          let lng = a.lng + (b.lng - a.lng) * t
          // Ángulo por defecto en grados; si hay mapa, del vector en pantalla.
          let angle = getHeadingAngle(a, b)
          // Interpolar en el espacio proyectado hace que el avión vaya SOBRE la
          // línea recta que dibuja Leaflet (que es recta en píxeles, no en grados).
          if (mapInstance) {
            const pa = mapInstance.latLngToLayerPoint([a.lat, a.lng])
            const pb = mapInstance.latLngToLayerPoint([b.lat, b.lng])
            const p = mapInstance.layerPointToLatLng([
              pa.x + (pb.x - pa.x) * t,
              pa.y + (pb.y - pa.y) * t,
            ])
            lat = p.lat
            lng = p.lng
            // atan2 con Y de pantalla (crece hacia abajo), sin invertir dy.
            angle = Math.atan2(pb.y - pa.y, pb.x - pa.x) * (180 / Math.PI)
          }
          const pct = dot.capacidadTotal > 0 ? (dot.maletas / dot.capacidadTotal) * 100 : 0
          const color = getPlaneColors(pct)
          // T55: filtro por semáforo de UT — atenuar aviones del color oculto.
          // Regla del profesor: si el aeropuerto origen o destino está filtrado
          // (por color o continente), también se oculta el vuelo asociado.
          const semUt = getPlaneSemaforo(pct)
          const utAtenuada = utsOcultas.has(semUt)
            || icaosOcultos.has(dot.desde) || icaosOcultos.has(dot.hasta)
          const planeIcon = createPlaneIcon({ fill: color.fill, stroke: color.stroke, angle, count: dot.count })

          return (
            <Marker
              key={`${dot.desde}-${dot.hasta}`}
              opacity={utAtenuada ? 0.2 : 1}
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
          // T54: atenuar si el almacén está filtrado (por color o continente).
          const atenuado = icaosOcultos.has(ap.codigo)
          const airportIcon = createAirportIcon({ fill: hex, atenuado })

          return (
            <Marker
              key={ap.codigo}
              position={[pos.lat, pos.lng]}
              icon={airportIcon}
              opacity={atenuado ? 0.25 : 1}
              eventHandlers={{
                // T50: clic abre el detalle en panel de la misma vista (no navega).
                // Vinculación mapa→panel: notificar al padre el aeropuerto elegido.
                click: () => {
                  setAlmacenSeleccionado(ap.codigo)
                  onSelectAirportFromMap?.(ap.codigo)
                },
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
            </Marker>
          )
        })}
      </MapContainer>

      {/* Tiempos compactados en UNA tarjeta densa: el profesor pidió que los
          tiempos no roben tanto espacio vertical (el mapa es lo importante),
          pero que sigan visibles. Simulado arriba, real abajo, transcurridos
          en una línea cada uno. */}
      <div className="absolute top-3 left-3 z-[1000] pointer-events-none">
        <div className="bg-slate-950/95 backdrop-blur border border-blue-500/25 rounded-lg overflow-hidden shadow-lg shadow-black/50 w-52">
          {simTime && (
            <div className="px-3 py-2 border-b border-slate-700/50">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-blue-300 uppercase tracking-widest font-semibold">Simulado</span>
                <span className="text-[10px] text-slate-400 font-mono">{formatSimDateTime(simTime).split(' ')[0]}</span>
              </div>
              <div className="flex items-baseline justify-between mt-0.5">
                <span className="text-2xl font-bold font-mono text-white leading-none">{formatSimDateTime(simTime).split(' ')[1]}</span>
                <span className="text-[11px] font-mono text-green-400">+{formatElapsed(simStart ? simTime - simStart : null)}</span>
              </div>
            </div>
          )}
          <div className="px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-emerald-300 uppercase tracking-widest font-semibold">Real</span>
              <span className="text-[10px] text-slate-400 font-mono">{formatSimDateTime(realTime).split(' ')[0]}</span>
            </div>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="text-lg font-bold font-mono text-emerald-400 leading-none">{formatRealTime(realTime)}</span>
              <span className="text-[11px] font-mono text-emerald-400">
                {inicioReal ? `+${formatElapsedReal(realTime - inicioReal)}` : '--:--'}
              </span>
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

      {/* T45/T47/T49: vinculación — buscar envío (resaltar ruta) / aeropuerto (enfocar).
          Bajados a top-20 para dejar la franja superior a la tira de indicadores globales. */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] flex gap-2">
        <div className="bg-slate-900/92 backdrop-blur border border-slate-700 rounded-lg px-2 py-1.5 flex items-center gap-1.5 shadow-lg">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider hidden sm:inline">Envío</span>
          <input
            value={busquedaInput}
            onChange={e => setBusquedaInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscarEnvio()}
            placeholder="ID de envío…"
            className="w-28 bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <button onClick={buscarEnvio} title="Resaltar ruta del envío"
            className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium">Buscar</button>
          {envioBuscado && (
            <button onClick={limpiarBusqueda} title="Limpiar"
              className="px-1.5 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs">✕</button>
          )}
        </div>
        <div className="bg-slate-900/92 backdrop-blur border border-slate-700 rounded-lg px-2 py-1.5 flex items-center gap-1.5 shadow-lg">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider hidden sm:inline">Almacén</span>
          <input
            value={airportInput}
            onChange={e => setAirportInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && enfocarAeropuerto(airportInput)}
            placeholder="ICAO…"
            className="w-20 bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1 placeholder-slate-500 focus:outline-none focus:border-blue-500 uppercase"
          />
          <button onClick={() => enfocarAeropuerto(airportInput)} title="Centrar en el aeropuerto"
            className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium">Ir</button>
        </div>
      </div>

      {/* P11: banner de "modo búsqueda" — deja explícito que el resaltado es
          TEMPORAL y cómo volver al estado anterior (botón o tecla Esc). */}
      {envioBuscado && tramosEnvioBuscado && tramosEnvioBuscado.size > 0 && (
        <div className="absolute top-32 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 bg-blue-500/15 border border-blue-500/40 text-blue-200 text-xs rounded-full px-3 py-1.5 shadow-lg">
          <span className="text-blue-300">🔍</span>
          <span>Búsqueda: ruta del envío <b className="font-mono text-white">{envioBuscado}</b></span>
          <button onClick={limpiarBusqueda}
            className="ml-1 px-2 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]">
            Volver (Esc)
          </button>
        </div>
      )}

      {/* Aviso cuando el envío buscado no tiene ruta visible */}
      {envioBuscado && tramosEnvioBuscado && tramosEnvioBuscado.size === 0 && (
        <div className="absolute top-32 left-1/2 -translate-x-1/2 z-[1000] bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs rounded px-3 py-1.5">
          No se encontró ruta para el envío "{envioBuscado}".
        </div>
      )}

      {/* T54/T55: filtros por semáforo (almacenes y UT) reflejados en el mapa.
          Reubicado a la derecha (bajo los botones de zoom) para despejar el
          eje vertical: la esquina inferior-izquierda tapaba el sur de
          Sudamérica (Argentina/Chile), que el profesor pidió mantener visible. */}
      <div className="absolute top-32 right-3 z-[1000] bg-slate-900/92 backdrop-blur border border-slate-700 rounded-xl p-3 shadow-lg w-44 max-h-[60vh] overflow-y-auto">
        <FiltroSemaforo
          titulo="Almacenes"
          ocultos={almacenesOcultos}
          onToggle={(c) => setAlmacenesOcultos(prev => toggleSet(prev, c))}
        />
        <div className="h-px bg-slate-700 my-2" />
        <FiltroSemaforo
          titulo="UT (aviones)"
          ocultos={utsOcultas}
          onToggle={(c) => setUtsOcultas(prev => toggleSet(prev, c))}
        />
        {continentes.length > 1 && (
          <>
            <div className="h-px bg-slate-700 my-2" />
            <FiltroContinente
              continentes={continentes}
              ocultos={continentesOcultos}
              onToggle={(c) => setContinentesOcultos(prev => toggleSet(prev, c))}
            />
          </>
        )}
      </div>

      {/* T50: detalle del almacén seleccionado en la MISMA vista (sin navegar) */}
      {detalleAlmacen?.ap && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 mt-32 z-[1100] bg-slate-900/96 backdrop-blur border border-blue-500/40 rounded-xl p-4 shadow-xl w-72">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="font-bold text-white text-sm">{detalleAlmacen.ap.nombre ?? almacenSeleccionado}</div>
              <div className="text-blue-300 font-mono text-xs">{almacenSeleccionado}</div>
            </div>
            <button onClick={() => setAlmacenSeleccionado(null)}
              className="text-slate-400 hover:text-white text-sm">✕</button>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-slate-400">Capacidad</span>
              <span className="font-mono text-slate-200">{(detalleAlmacen.ap.almacen?.capacidad ?? 0).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Envíos que entran</span>
              <span className="font-mono text-green-400">{detalleAlmacen.entran} ({detalleAlmacen.maletasEntran.toLocaleString()} mal.)</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Envíos que salen</span>
              <span className="font-mono text-amber-400">{detalleAlmacen.salen} ({detalleAlmacen.maletasSalen.toLocaleString()} mal.)</span></div>
          </div>
          <button onClick={() => navigate(`/aeropuerto/${almacenSeleccionado}`)}
            className="mt-3 w-full py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium">
            Ver detalle completo →
          </button>
        </div>
      )}

      {simTime && (
        <div className="absolute bottom-14 left-4 right-4 z-[1000]">
          <div className="bg-slate-900/92 backdrop-blur border border-slate-700 rounded-xl px-4 py-2.5 flex items-center gap-3">
            <button
              onClick={() => setIsPlaying(p => {
                const next = !p
                // Registrar la intención del usuario: al pausar, marcar pausa
                // manual (el auto-respiro no debe reanudar). Al dar play, limpiarla.
                pausaManualRef.current = !next
                return next
              })}
              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold transition-colors"
              title={isPlaying ? 'Pausar' : 'Reproducir'}
            >
              {isPlaying ? '||' : '>'}
            </button>

            <div
              className={`flex-1 bg-slate-700/80 rounded-full h-1.5 ${liveMode ? 'cursor-default' : 'cursor-pointer'}`}
              onClick={e => {
                // En vivo el reloj lo marca el backend (progreso por épocas): no
                // permitimos saltar a un punto arbitrario, rompería la sincronía.
                if (liveMode || !simStart || !simEnd) return
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

// Normaliza un ID de envío para comparar sin importar los ceros de relleno:
// "000000028" → "28", "ABC-007" → "abc-7". Si es puramente numérico quita los
// ceros a la izquierda; en cualquier caso compara en minúsculas y sin espacios.
function normalizarId(id) {
  const s = String(id ?? '').trim().toLowerCase()
  if (/^\d+$/.test(s)) return String(parseInt(s, 10))
  return s.replace(/\b0+(\d)/g, '$1')
}

// Alterna un color en un Set (sin mutar el original).
function toggleSet(set, color) {
  const next = new Set(set)
  if (next.has(color)) next.delete(color); else next.add(color)
  return next
}

// T54/T55: selector de colores de semáforo. Un color "apagado" (en `ocultos`)
// atenúa en el mapa las entidades de ese color.
const SEMAFORO_FILTRO = [
  { color: 'vacio', hex: '#94a3b8', label: 'Vacío' },
  { color: 'verde', hex: '#4ade80', label: 'Baja carga' },
  { color: 'ambar', hex: '#fbbf24', label: 'Carga media' },
  { color: 'rojo',  hex: '#f87171', label: 'Carga alta' },
]

// Casilla (checkbox) reutilizable: marcada = visible, desmarcada = oculto.
function FiltroCheck({ marcado, onToggle, hex, label }) {
  return (
    <button onClick={onToggle}
      className={`w-full flex items-center gap-2 text-xs rounded px-1 py-0.5 transition-colors ${marcado ? 'text-slate-200' : 'text-slate-500'}`}
      title={marcado ? 'Click para ocultar en el mapa' : 'Click para mostrar en el mapa'}>
      <span className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center text-[9px] font-bold ${
        marcado ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-600 text-transparent'}`}>
        ✓
      </span>
      {hex && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hex, opacity: marcado ? 1 : 0.3 }} />}
      <span className="truncate">{label}</span>
    </button>
  )
}

function FiltroSemaforo({ titulo, ocultos, onToggle }) {
  return (
    <div>
      <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1.5">{titulo}</p>
      <div className="flex flex-col gap-0.5">
        {SEMAFORO_FILTRO.map(s => (
          <FiltroCheck key={s.color} marcado={!ocultos.has(s.color)}
            onToggle={() => onToggle(s.color)} hex={s.hex} label={s.label} />
        ))}
      </div>
    </div>
  )
}

// Filtro por continente (multiselección). Ocultar un continente atenúa sus
// aeropuertos y los vuelos hacia/desde ellos.
function FiltroContinente({ continentes, ocultos, onToggle }) {
  return (
    <div>
      <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1.5">Continente</p>
      <div className="flex flex-col gap-0.5">
        {continentes.map(c => (
          <FiltroCheck key={c} marcado={!ocultos.has(c)} onToggle={() => onToggle(c)} label={c} />
        ))}
      </div>
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
