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
import { getAirports, getAllFlights, getPlanningRunRoutes } from '../services/api'
import { buildRouteLegs, RECOJO_DESTINO_MS } from '../services/rutaTramos'

// Respiro entre bloques (ms): al terminar los vuelos de una época y llegar la
// siguiente, la reproducción espera este instante antes de reanudar, para que la
// transición entre épocas se perciba (petición explícita: pausa "natural" de
// unos segundos entre bloques).
const RESPIRO_MS = 3000

// G05: la reconstrucción de tramos (y con ella la permanencia mínima de la
// maleta en cada escala) vive en services/rutaTramos.js — es lógica pura y así
// se puede probar aislada del mapa.

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

function formatRealDateTime(date) {
  if (!date) return '-'
  const p = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${formatRealTime(date)}`
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

/**
 * D14: marca de vuelo cancelado. Va en el aeropuerto de salida, desplazada
 * arriba a la derecha para no tapar el ícono del propio aeropuerto, y late para
 * que se distinga de un elemento estático del mapa.
 *
 * Constante (no depende de datos): se crea una sola vez, porque el mapa se
 * re-renderiza cada segundo con el reloj en vivo y reemplazar el DOM del
 * marcador deja los tooltips pegados abiertos.
 */
const cancelIcon = L.divIcon({
  className: 'tasf-cancel-icon-wrapper',
  html: `
    <div class="tasf-cancel-icon">
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="#ef4444" stroke="#ffffff" stroke-width="2"/>
        <path d="M8 8 L16 16 M16 8 L8 16" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
    </div>
  `,
  iconSize: [24, 24],
  iconAnchor: [-4, 20],
})

// T6: ícono de aeropuerto (en vez de un círculo). El color del semáforo va en
// el relleno; el borde blanco lo mantiene legible sobre el mapa oscuro.
// Cacheado por fill: sin esto, MapaMundi se re-renderiza cada segundo (reloj
// en vivo) y cada render creaba un ícono nuevo, forzando a Leaflet a
// reemplazar el DOM del marcador. El navegador no dispara "mouseout" cuando
// el elemento bajo el cursor se reemplaza, así que el tooltip de hover
// quedaba pegado abierto aunque el mouse ya no estuviera ahí.
//
// Ya no admite atenuación: un aeropuerto filtrado se OCULTA del todo (no se
// llega a llamar esta función para él), igual que día a día.
const airportIconCache = new Map()
function createAirportIcon({ fill }) {
  const cached = airportIconCache.get(fill)
  if (cached) return cached
  const icon = L.divIcon({
    className: 'tasf-airport-icon-wrapper',
    html: `
      <div class="tasf-airport-icon" style="--ap-fill:${fill};">
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
  airportIconCache.set(fill, icon)
  return icon
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
  onOperationalShipmentsChange,
  focusAirport,
  highlightShipment,
  onSelectAirportFromMap,
  // F07/F08: vinculación bidireccional de unidades de transporte (aviones).
  focusFlight,
  onSelectFlightFromMap,
  // D14/D15: vuelos cancelados durante la corrida, para marcarlos en el mapa.
  cancelaciones = [],
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
  // Panel de filtros colapsable: cerrado por defecto para no tapar el mapa.
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false)

  // T50: aeropuerto seleccionado para ver su detalle en panel (misma vista).
  const [almacenSeleccionado, setAlmacenSeleccionado] = useState(null)

  // F07: vuelo resaltado tras seleccionarlo en el panel.
  const [vueloResaltado, setVueloResaltado] = useState(null)


  // C27: vuelos SIN carga que la simulación despachó, informados por el backend
  // en cada época (`vuelosEpoca` con maletas = 0). Se acumulan por época para
  // poder pintarlos en gris cuando el reloj pasa por su ventana de vuelo.
  const [vuelosVaciosBackend, setVuelosVaciosBackend] = useState([])

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
    setInicioReal(null)
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

    // C27: quedarse con los vuelos que la simulación despachó VACÍOS en esta
    // época. Los que llevan carga ya se dibujan a partir de las rutas, así que
    // aquí solo interesan los de 0 maletas.
    if (Array.isArray(liveEvent.vuelosEpoca)) {
      const vacios = liveEvent.vuelosEpoca
        .filter(v => (v.maletas ?? 0) === 0 && v.salida && v.llegada)
        .map(v => ({
          key: `${v.businessId}@${v.salida}`,
          flightBusinessId: v.businessId,
          desde: v.origenIcao,
          hasta: v.destinoIcao,
          salida: new Date(v.salida),
          llegada: new Date(v.llegada),
          capacidadTotal: v.capacidad ?? 0,
        }))
      setVuelosVaciosBackend(prev => {
        const porClave = new Map(prev.map(v => [v.key, v]))
        vacios.forEach(v => porClave.set(v.key, v))
        return Array.from(porClave.values())
      })
    }

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
    // Antes: getFlights(0, 500) — una sola página. El dataset real tiene
    // ~2.866 vuelos plantilla, así que 500 dejaba fuera a la mayoría: un tramo
    // que usara un vuelo fuera de esos primeros 500 no encontraba su entrada en
    // flightMap y se descartaba en silencio (buildRouteLegs), reduciendo de
    // golpe los aviones que el mapa podía llegar a mostrar.
    getAllFlights()
      .then(setFlights)
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

  // G05: plan de viaje del envío buscado, tramo a tramo, con el tiempo que la
  // maleta permanece en tierra en cada escala. Hace verificable a simple vista
  // que ninguna conexión baja de la permanencia mínima (10 min).
  const planEnvioBuscado = useMemo(() => {
    if (!envioBuscado) return null
    const objetivo = normalizarId(envioBuscado)
    const legs = allLegs
      .filter(l => normalizarId(l.shipmentId) === objetivo)
      .sort((a, b) => a.salida - b.salida)
    if (legs.length === 0) return null
    return {
      legs,
      maletas: legs[0].cantidadMaletas ?? 0,
      // Entrega efectiva = aterrizaje del último tramo + recojo en destino.
      entrega: new Date(legs[legs.length - 1].llegada.getTime() + RECOJO_DESTINO_MS),
    }
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

  // Coordenadas por ICAO. Declarado aquí (y no más abajo) porque el cálculo de
  // los vuelos vacíos en el aire lo necesita antes de renderizar.
  const coords = useMemo(() => {
    const c = {}
    Object.values(aeropuertosConOcupacion).forEach(ap => {
      if (Number.isFinite(ap.latitud) && Number.isFinite(ap.longitud)) {
        c[ap.codigo] = { lat: ap.latitud, lng: ap.longitud }
      }
    })
    return c
  }, [aeropuertosConOcupacion])

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

  const activeLegs = useMemo(() => (
    simTime
      ? allLegs
          .filter(leg => leg.salida <= simTime && simTime <= leg.llegada)
          .map(leg => ({ ...leg, progreso: (simTime - leg.salida) / (leg.llegada - leg.salida) }))
      : []
  ), [allLegs, simTime])
  
  const enviosOperativos = useMemo(() => {
    if (!simTime) {
      return {
        planificados: [],
        enVuelo: [],
        entregados4h: [],
      }
    }

    const convertir = (leg, estado) => ({
      shipmentId: leg.shipmentId,
      flightBusinessId: leg.flightBusinessId,
      origenIcao: leg.desde,
      destinoIcao: leg.hasta,
      cantidadMaletas: leg.cantidadMaletas ?? 0,
      salida: leg.salida,
      llegada: leg.llegada,
      progreso: leg.progreso ?? 0,
      estado,
    })

    // Tramos cuya salida todavía no ocurrió.
    const planificados = allLegs
      .filter(leg => leg.salida > simTime)
      .map(leg => convertir(leg, 'PLANIFICADO'))

    // Tramos activos en este instante.
    const enVuelo = activeLegs.map(leg =>
      convertir(leg, 'EN_VUELO')
    )

    /*
    * Para considerar un envío como entregado usamos solamente
    * el último tramo de su ruta. Una escala intermedia no cuenta
    * como entrega final.
    */
    const ultimoTramoPorEnvio = new Map()

    allLegs.forEach(leg => {
      const anterior = ultimoTramoPorEnvio.get(leg.shipmentId)

      if (!anterior || leg.llegada > anterior.llegada) {
        ultimoTramoPorEnvio.set(leg.shipmentId, leg)
      }
    })

    const cuatroHorasAntes = new Date(
      simTime.getTime() - 4 * 60 * 60 * 1000
    )

    const entregados4h = Array.from(ultimoTramoPorEnvio.values())
      .filter(leg =>
        leg.llegada <= simTime &&
        leg.llegada >= cuatroHorasAntes
      )
      .map(leg => convertir(leg, 'ENTREGADO'))

    return {
      planificados,
      enVuelo,
      entregados4h,
    }
  }, [allLegs, activeLegs, simTime])    
  
  useEffect(() => {
    onOperationalShipmentsChange?.(enviosOperativos)
  }, [enviosOperativos, onOperationalShipmentsChange])
  
  // Cada vuelo FÍSICO es su propio avión en el mapa. La clave es el vuelo
  // (flightBusinessId + hora exacta de salida), no el par origen-destino: dos
  // vuelos distintos entre los mismos aeropuertos (horarios distintos) deben
  // verse como dos aviones separados, cada uno en su propio punto de la ruta.
  // Envíos que SÍ comparten el mismo vuelo físico (mismo id + misma salida)
  // siguen fusionándose en un solo ícono con el badge de conteo.
  const activeDotMap = useMemo(() => {
    const map = {}
    activeLegs.forEach(leg => {
      const key = `${leg.flightBusinessId}@${leg.salida.getTime()}`
      if (!map[key]) {
        map[key] = {
          key,
          flightBusinessId: leg.flightBusinessId,
          desde: leg.desde,
          hasta: leg.hasta,
          progreso: leg.progreso,
          count: 0,
          maletas: 0,
          // Capacidad del vuelo físico: es una sola (la del avión), no se suma
          // por cada envío que viaja en él.
          capacidadTotal: leg.capacidadVuelo ?? 0,
        }
      }
      map[key].count += 1
      map[key].maletas += leg.cantidadMaletas
    })
    return map
  }, [activeLegs])
  // C27: los aviones VACÍOS también deben verse. `activeDotMap` se arma desde
  // los envíos planificados, así que un vuelo sin carga asignada nunca llegaba
  // a dibujarse y el filtro "Vacío" no mostraba nada. Aquí completamos con los
  // vuelos del catálogo que están en el aire en el instante simulado y no
  // transportan ningún envío: se pintan en gris (semáforo vacío) con 0 maletas.
  // C27: aviones VACÍOS que están en el aire en el instante simulado. Salen de
  // los vuelos que el backend informó con 0 maletas (`vuelosEpoca`), nunca de
  // inventar ocurrencias del catálogo en el front: si un tramo tiene demanda el
  // planificador le asigna carga, así que un gris sobre una ruta con envíos
  // sería una contradicción.
  const vuelosVaciosEnAire = useMemo(() => {
    if (!simTime) return []
    // Antes esto exigía que el tramo YA tuviera una línea dibujada, es decir,
    // que en esa misma ruta viajara también un envío con carga. Esa
    // restricción (igual que la que había en el backend, en vuelosDeEpoca)
    // dejaba fuera la inmensa mayoría de la flota: día a día no la tiene —
    // muestra cualquier vuelo del catálogo que esté en el aire, lleve carga o
    // no — y cada avión dibuja su propia línea (ver el bloque de Polyline más
    // abajo), así que no hace falta depender de `rutasLineas`.
    return vuelosVaciosBackend
      .filter(v => v.salida <= simTime && simTime <= v.llegada
        && coords[v.desde] && coords[v.hasta])
      .map(v => ({
        key: v.key,
        flightBusinessId: v.flightBusinessId,
        desde: v.desde,
        hasta: v.hasta,
        progreso: (simTime - v.salida) / (v.llegada - v.salida),
        count: 0,
        maletas: 0,
        capacidadTotal: v.capacidadTotal,
      }))
  }, [vuelosVaciosBackend, simTime, coords])

  /**
   * D14/D15: cancelaciones vigentes en el instante simulado.
   *
   * Una cancelación se muestra desde que se registra hasta la hora en que ese
   * avión habría despegado — "el tiempo previsto" de D15. Antes de esa hora es
   * información operativa (ese vuelo no va a salir); pasada la salida deja de
   * serlo, y mantenerla llenaría el mapa de cruces de vuelos que ya no importan.
   */
  const cancelacionesResueltas = useMemo(() => {
    if (!cancelaciones.length || !flights.length) return []
    const porId = new Map(flights.map(f => [f.businessId, f]))
    return cancelaciones.flatMap(c => {
      const vuelo = porId.get(c.flightBusinessId)
      if (!vuelo || !c.dia) return []
      // El backend identifica la salida por día; la hora está en la plantilla.
      const salida = new Date(`${c.dia}T${vuelo.horaSalida}`)
      if (Number.isNaN(salida.getTime())) return []
      return [{
        ...c,
        salida,
        desde: vuelo.origenIcao,
        hasta: vuelo.destinoIcao,
      }]
    })
  }, [cancelaciones, flights])

  const cancelacionesVigentes = useMemo(() => {
    if (!simTime) return []
    return cancelacionesResueltas
      .filter(c => simTime <= c.salida)
      .map(c => ({
        ...c,
        // Minutos simulados que faltan para la salida que no ocurrirá.
        minutosParaSalida: Math.round((c.salida - simTime) / 60000),
      }))
      .sort((a, b) => a.salida - b.salida)
  }, [cancelacionesResueltas, simTime])

  /**
   * D14: salidas canceladas, para que su avión no se dibuje. El backend ya no
   * las planifica, pero las rutas de la época en la que se canceló siguen
   * mencionándolas: sin este filtro el mapa animaría un despegue que la
   * operación anuló, que es justo lo que la prueba comprueba que NO pasa.
   *
   * La comparación es (vuelo, día de salida) y no el id de instancia del
   * backend: el mapa reconstruye las salidas por su cuenta y las identifica con
   * la marca de tiempo exacta, así que los dos identificadores no coinciden. El
   * día sí, y basta — un vuelo recurrente tiene una sola salida diaria.
   */
  const salidasCanceladas = useMemo(
    () => new Set(
      cancelacionesResueltas.map(c => `${c.flightBusinessId}@${c.salida.toDateString()}`),
    ),
    [cancelacionesResueltas],
  )

  /**
   * (vuelo, día de salida) de los aviones que en este instante SÍ llevan carga
   * — mismo criterio de clave que `salidasCanceladas` (día, no milisegundo
   * exacto, porque `activeDotMap` y `vuelosVaciosEnAire` identifican la salida
   * con formatos distintos).
   *
   * Hace falta para blindar el mapa contra "fantasmas vacíos": `vuelosVaciosBackend`
   * se acumula época a época y nunca se limpia, así que si ese mismo vuelo
   * pasó de ir vacío (en la época en que se reportó) a llevar carga (por una
   * reasignación posterior, p. ej. tras cancelar otro vuelo), el registro
   * "vacío" seguía sirviéndose para siempre y se dibujaba superpuesto al avión
   * real — se veía un avión blanco (vacío) que en realidad llevaba envíos.
   */
  const vuelosConCargaHoy = useMemo(
    () => new Set(
      Object.values(activeDotMap).map(d => {
        const raw = d.key?.split('@')[1]
        const dia = new Date(Number(raw) || raw)
        return `${d.flightBusinessId}@${dia.toDateString()}`
      }),
    ),
    [activeDotMap],
  )

  const activeDots = [
    ...Object.values(activeDotMap),
    ...vuelosVaciosEnAire.filter(v => {
      const raw = v.key?.split('@')[1]
      if (!raw) return true
      const dia = new Date(Number(raw) || raw)
      return !vuelosConCargaHoy.has(`${v.flightBusinessId}@${dia.toDateString()}`)
    }),
  ]
    .filter(d => {
      const salida = d.key?.split('@')[1]
      if (!salida) return true
      const dia = new Date(Number(salida) || salida)
      return !salidasCanceladas.has(`${d.flightBusinessId}@${dia.toDateString()}`)
    })

  // F07: tramo de la UT resaltada desde el panel. Si está en el aire usamos
  // su posición activa; si todavía no despega o ya aterrizó, usamos el catálogo
  // para mantener visible el origen/destino y poder centrar igualmente el mapa.
  const tramoVueloResaltado = useMemo(() => {
    if (!vueloResaltado) return null

    const dot = activeDots.find(d => d.flightBusinessId === vueloResaltado)
    if (dot) return `${dot.desde}-${dot.hasta}`

    const vuelo = flights.find(f => String(f.businessId ?? f.id) === String(vueloResaltado))
    if (!vuelo?.origenIcao || !vuelo?.destinoIcao) return null
    return `${vuelo.origenIcao}-${vuelo.destinoIcao}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vueloResaltado, activeDotMap, vuelosVaciosEnAire, flights])

  // Tramos que ahora mismo tienen un avión encima: su línea debe verse siempre.
  const tramosConAvion = useMemo(
    () => new Set(activeDots.map(d => `${d.desde}-${d.hasta}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeDotMap, vuelosVaciosEnAire],
  )

  // T41: reportar al padre (Dashboard) los envíos actualmente en vuelo, para
  // mostrarlos como lista. Solo emite cuando el conjunto realmente cambia
  // (comparando una firma estable) para no entrar en bucle de renders.
  const enVueloPayload = useMemo(
    () => activeLegs.map(l => ({
      flightBusinessId: l.flightBusinessId,
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
    // Solo puede haber un resaltado activo: al enfocar un envío se descarta el
    // de la unidad de transporte, o quedarían dos rutas en amarillo a la vez.
    setVueloResaltado(null)
  }, [highlightShipment])

  // F07: vinculación panel→mapa para unidades de transporte. Al elegir un vuelo
  // en el panel se resalta y, si está en el aire, se centra el mapa sobre él.
  useEffect(() => {
    if (!focusFlight) return
    // id null = se cerró la selección en el panel: quitar el resaltado.
    if (!focusFlight.id) { setVueloResaltado(null); return }
    setVueloResaltado(String(focusFlight.id))
    // Excluyente con el resaltado de envío (ver highlightShipment).
    setEnvioBuscado('')
    setBusquedaInput('')
    if (!mapInstance) return

    const dot = activeDots.find(d => d.flightBusinessId === focusFlight.id)
    if (dot) {
      const a = coords[dot.desde]
      const b = coords[dot.hasta]
      if (!a || !b) return
      const lat = a.lat + (b.lat - a.lat) * dot.progreso
      const lng = a.lng + (b.lng - a.lng) * dot.progreso
      mapInstance.flyTo([lat, lng], Math.max(mapInstance.getZoom(), 4), { duration: 0.8 })
      return
    }

    // La UT puede estar planificada pero todavía no aparecer como avión activo.
    // En ese caso centramos el mapa en el punto medio de su tramo.
    const vuelo = flights.find(f => String(f.businessId ?? f.id) === String(focusFlight.id))
    if (!vuelo) return
    const a = coords[vuelo.origenIcao]
    const b = coords[vuelo.destinoIcao]
    if (!a || !b) return
    mapInstance.flyTo(
      [(a.lat + b.lat) / 2, (a.lng + b.lng) / 2],
      Math.max(mapInstance.getZoom(), 4),
      { duration: 0.8 },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusFlight])

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
            || tramoVueloResaltado === `${r.desde}-${r.hasta}`
            || !r.revealAt || !simTime || simTime >= r.revealAt
            // Si hay un avión (aunque vaya vacío) recorriendo el tramo ahora,
            // su línea debe estar dibujada: un avión sin trayectoria confunde.
            || tramosConAvion.has(`${r.desde}-${r.hasta}`))
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
            // (aeropuerto oculto por color/continente), OCULTAR del todo la
            // ruta — igual que día a día (ver MapaDiaADia.jsx): antes esto solo
            // atenuaba con una opacidad casi invisible, pero seguía siendo un
            // elemento dibujado en el mapa en vez de desaparecer como pide el
            // filtro.
            const tramoOculto = icaosOcultos.has(ruta.desde) || icaosOcultos.has(ruta.hasta)
            // F07: tramo del vuelo seleccionado en el panel.
            const esTramoVueloResaltado = tramoVueloResaltado === key
            // El filtro gana salvo que el propio tramo esté resaltado a
            // propósito (por búsqueda de envío o selección de vuelo): esos dos
            // casos son una acción explícita del usuario sobre ESE tramo en
            // concreto, y deben poder verse aunque su aeropuerto esté oculto.
            if (tramoOculto && !esTramoVueloResaltado && !esDelEnvio) {
              return null
            }
            let pathOptions
            if (esTramoVueloResaltado) {
              pathOptions = { color: '#facc15', weight: 3, opacity: 0.95 }
            } else if (tramosEnvioBuscado) {
              // Al resaltar un envío el resto se atenúa, pero sigue visible:
              // borrarlas del todo dejaba el mapa vacío y se perdía el contexto
              // de la operación alrededor de la ruta buscada.
              pathOptions = esDelEnvio
                ? { color: '#facc15', weight: 4, opacity: 0.95 }                    // resaltado
                : { color: '#3b82f6', weight: 1, opacity: 0.22, dashArray: '4 8' }  // contexto
            } else if (recorrida) {
              pathOptions = { color: '#475569', weight: 1, opacity: 0.2, dashArray: '2 8' }
            } else {
              // C34: trazo fino y segmentado (el profesor pidió bajar grosor y
              // hacerlo más tenue), pero con opacidad suficiente para que la
              // trayectoria siga siendo legible sobre el mapa oscuro.
              pathOptions = { color: '#3b82f6', weight: 1.5, opacity: 0.5, dashArray: '5 7' }
            }
            return (
              <Polyline
                key={key}
                positions={[[a.lat, a.lng], [b.lat, b.lng]]}
                pathOptions={pathOptions}
              />
            )
          })}

        {/* Línea propia para los aviones (sobre todo los vacíos) cuyo tramo NO
            tiene ninguna ruta de carga (`rutasLineas` sale solo de `allLegs`,
            es decir, de envíos con carga): sin esto, un vuelo vacío en un
            tramo que ningún envío usa se dibujaba sin trayectoria debajo — o,
            con el filtro que había antes, no se dibujaba en absoluto. Mismo
            criterio que usa día a día (cada avión dibuja su propia línea, sin
            depender de si alguien más ya la dibujó). */}
        {[...tramosConAvion]
          .filter(t => !rutasLineas.some(r => `${r.desde}-${r.hasta}` === t))
          .map(t => {
            const [desde, hasta] = t.split('-')
            const a = coords[desde]
            const b = coords[hasta]
            if (!a || !b) return null
            // Misma regla que las líneas de rutasLineas: aeropuerto oculto por
            // filtro (color de almacén o continente) oculta también esta línea.
            if (icaosOcultos.has(desde) || icaosOcultos.has(hasta)) return null
            return (
              <Polyline
                key={`sin-carga-${t}`}
                positions={[[a.lat, a.lng], [b.lat, b.lng]]}
                pathOptions={{ color: '#94a3b8', weight: 1.5, opacity: 0.45, dashArray: '4 8' }}
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
          const semUt = getPlaneSemaforo(pct)
          // F07: el vuelo elegido en el panel se pinta en amarillo para ubicarlo.
          const esResaltado = vueloResaltado && dot.flightBusinessId === vueloResaltado
          // T55: filtro por semáforo de UT. Regla del profesor: si el
          // aeropuerto origen o destino está filtrado (por color o
          // continente), también se oculta el vuelo asociado. Igual que día a
          // día: el filtro OCULTA del todo (antes solo bajaba la opacidad a
          // 0.2, y el avión seguía ahí estorbando la lectura del mapa) —
          // salvo que el propio avión esté resaltado a propósito desde el
          // panel, que es una acción explícita del usuario sobre ESE avión.
          const utOculto = (utsOcultas.has(semUt)
            || icaosOcultos.has(dot.desde) || icaosOcultos.has(dot.hasta))
            && !esResaltado
          if (utOculto) return null

          const planeIcon = createPlaneIcon({
            fill: esResaltado ? '#facc15' : color.fill,
            stroke: esResaltado ? '#fde047' : color.stroke,
            angle,
            count: dot.count,
          })

          return (
            <Marker
              key={dot.key}
              position={[lat, lng]}
              icon={planeIcon}
              eventHandlers={{
                // F08: vinculación mapa→panel. Al hacer clic en un avión se
                // notifica al padre para que el panel lo busque y lo enfoque.
                click: () => onSelectFlightFromMap?.(dot.flightBusinessId),
              }}
            >
              <Tooltip direction="top" offset={[0, -10]} className="tasf-tooltip" opacity={1}>
                <div className="text-xs">
                  <div className="font-bold text-white mb-1">{dot.desde} {'->'} {dot.hasta}</div>
                  <div className="font-mono text-[10px] text-slate-400 mb-1">{dot.flightBusinessId}</div>
                  <div className="text-slate-300">Envios: <span className="text-blue-300 font-semibold">{dot.count}</span></div>
                  <div className="text-slate-300">Maletas: <span className="text-blue-300 font-semibold">{dot.maletas.toLocaleString()}</span></div>
                  <div className="text-slate-300">Progreso: <span className="text-slate-200 font-semibold">{Math.round(dot.progreso * 100)}%</span></div>
                  <div className="text-blue-300 mt-1">Clic para ver su carga en el panel {'->'}</div>
                </div>
              </Tooltip>
            </Marker>
          )
        })}

        {/* D14: cada cancelación se marca en el aeropuerto del que ese vuelo
            habría despegado, con la cruz roja y el tramo afectado. D15: la marca
            vive mientras el vuelo seguía previsto (ver `cancelacionesVigentes`). */}
        {cancelacionesVigentes.map(c => {
          const pos = coords[c.desde]
          if (!pos) return null
          return (
            <Marker
              key={`cancel-${c.idInstancia}`}
              position={[pos.lat, pos.lng]}
              icon={cancelIcon}
              zIndexOffset={2000}
            >
              <Tooltip direction="top" offset={[0, -12]} className="tasf-tooltip" opacity={1}>
                <div className="text-xs">
                  <div className="font-bold text-red-300 mb-1">VUELO CANCELADO</div>
                  <div className="font-bold text-white">{c.desde} {'->'} {c.hasta}</div>
                  <div className="font-mono text-[10px] text-slate-400 mb-1">{c.flightBusinessId}</div>
                  <div className="text-slate-300">
                    Salida prevista: <span className="text-red-300 font-semibold">
                      {c.salida.toISOString().slice(11, 16)}
                    </span>
                  </div>
                  <div className="text-slate-300">
                    No despega en: <span className="text-amber-300 font-semibold">
                      {c.minutosParaSalida} min
                    </span>
                  </div>
                  {c.mensaje && (
                    <div className="text-blue-300 mt-1 max-w-[220px]">{c.mensaje}</div>
                  )}
                </div>
              </Tooltip>
            </Marker>
          )
        })}

        {Object.values(aeropuertosConOcupacion).map(ap => {
          const pos = coords[ap.codigo]
          if (!pos) return null
          // T54: si el almacén está filtrado (por color o continente), se
          // OCULTA del todo — igual que día a día (MapaDiaADia.jsx: "el
          // filtro de almacenes/continente los oculta del todo, no solo los
          // atenúa"). Antes esto solo bajaba la opacidad a 0.25.
          if (icaosOcultos.has(ap.codigo)) return null

          const pct = getOcupacionPct(ap)
          const color = getSemaforoPorOcupacion(pct)
          const hex = SEMAFORO_COLORES[color]
          const airportIcon = createAirportIcon({ fill: hex })

          return (
            <Marker
              key={ap.codigo}
              position={[pos.lat, pos.lng]}
              icon={airportIcon}
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
                  <div className="text-blue-300 mt-1">Mantén el cursor y haz clic para ver detalles {'->'}</div>
                </div>
              </Tooltip>
            </Marker>
          )
        })}
      </MapContainer>

      {/* Resumen temporal de la ejecución. Se distingue el calendario simulado
          del reloj real para que cada valor sea entendible durante la demostración. */}
      <div className="absolute top-3 left-3 z-[1000] pointer-events-none">
        <div className="bg-slate-950/95 backdrop-blur border border-blue-500/25 rounded-lg overflow-hidden shadow-lg shadow-black/50 w-72">
          <div className="px-3 py-2 border-b border-slate-700/50">
            <div className="text-[10px] text-blue-300 uppercase tracking-widest font-semibold mb-1.5">
              Tiempo de simulación
            </div>

            <div className="space-y-1 text-[11px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Fecha Inicio</span>
                <span className="font-mono text-sm font-bold text-white">{formatSimDateTime(simStart)}</span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-300 font-semibold">Hora simulación Actual</span>
                <span className="font-mono text-sm font-bold text-white">{formatSimDateTime(simTime)}</span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Tiempo simulación transcurrido</span>
                <span className="font-mono text-green-400 text-sm">
                  {formatElapsed(simStart && simTime ? simTime - simStart : null)}
                </span>
              </div>
            </div>
          </div>

          <div className="px-3 py-2">
            <div className="text-[10px] text-emerald-300 uppercase tracking-widest font-semibold mb-1.5">
              Tiempo real
            </div>

            <div className="space-y-1 text-[11px]">
{/*               <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Inicio real</span>
                <span className="font-mono text-slate-300 ">
                  {inicioReal ? formatRealDateTime(inicioReal) : 'Aún no iniciado'}
                </span>
              </div> */}

              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-300 font-semibold">Hora real actual</span>
                <span className="font-mono text-sm font-bold text-emerald-400">{formatRealDateTime(realTime)}</span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Tiempo real transcurrido</span>
                <span className="font-mono text-emerald-400 text-sm">
                  {inicioReal ? formatElapsedReal(realTime - inicioReal) : '--:--'}
                </span>
              </div>
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

      {/* D14/D15: cancelaciones vigentes. En el mapa cada una es una cruz roja
          sobre su aeropuerto de salida; aquí se listan con la cuenta atrás hasta
          la salida que no va a ocurrir, para poder seguirlas sin buscarlas. El
          panel desaparece cuando ya pasó la hora de todas ellas. */}
      {cancelacionesVigentes.length > 0 && (
        <div className="absolute bottom-20 right-4 z-[1000] bg-slate-900/95 backdrop-blur border border-red-500/40 rounded-xl shadow-xl px-3 py-2.5 w-64">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[11px] font-semibold text-red-300 uppercase tracking-wider">
              Vuelos cancelados ({cancelacionesVigentes.length})
            </span>
          </div>
          <ul className="space-y-1.5 max-h-40 overflow-y-auto">
            {cancelacionesVigentes.map(c => (
              <li key={c.idInstancia} className="text-[11px] leading-tight">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-white">{c.desde} → {c.hasta}</span>
                  <span className="font-mono text-red-300 shrink-0">
                    {c.salida.toISOString().slice(11, 16)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2 text-slate-400">
                  <span className="font-mono text-[10px] truncate">{c.flightBusinessId}</span>
                  <span className="text-amber-300 shrink-0">en {c.minutosParaSalida} min</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 pt-2 border-t border-slate-700 text-[10px] text-slate-500 leading-snug">
            No despegan. Sus maletas se replanifican en la siguiente época.
          </p>
        </div>
      )}

      {/* Aviso cuando el envío buscado no tiene ruta visible */}
      {envioBuscado && tramosEnvioBuscado && tramosEnvioBuscado.size === 0 && (
        <div className="absolute top-32 left-1/2 -translate-x-1/2 z-[1000] bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs rounded px-3 py-1.5">
          No se encontró ruta para el envío "{envioBuscado}".
        </div>
      )}

      {/* G05: plan de viaje del envío buscado. Muestra cada tramo y, entre
          tramos, cuánto permanece la maleta en el almacén de la escala; si
          bajara del mínimo se marcaría en rojo. */}
      {planEnvioBuscado && (
        <div className="absolute top-44 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl shadow-xl px-4 py-3 w-[26rem] max-h-72 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
              Plan de viaje · {planEnvioBuscado.maletas} maletas
            </span>
            <span className="text-[10px] text-slate-500">permanencia mín. 10 min</span>
          </div>

          <ol className="space-y-1">
            {planEnvioBuscado.legs.map((leg, i) => (
              <li key={`${leg.flightBusinessId}-${i}`}>
                {i > 0 && (
                  <div className={`flex items-center gap-1.5 text-[11px] pl-2 py-0.5 ${
                    leg.esperaMin >= 10 ? 'text-slate-400' : 'text-red-400'
                  }`}>
                    <span>⏱</span>
                    <span>
                      escala en <b className="font-mono text-slate-300">{leg.desde}</b>:{' '}
                      {formatElapsed(leg.esperaMin * 60000)}
                    </span>
                    <span>{leg.esperaMin >= 10 ? '✓' : '✕ bajo el mínimo'}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 text-xs bg-slate-800/60 rounded px-2 py-1.5">
                  <span className="font-mono text-slate-200">{leg.desde} → {leg.hasta}</span>
                  <span className="font-mono text-slate-400 text-[11px]">
                    {formatSimDateTime(leg.salida).slice(5)} → {formatSimDateTime(leg.llegada).slice(5)}
                  </span>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-2 pt-2 border-t border-slate-700 flex justify-between text-[11px]">
            <span className="text-slate-400">Entrega al cliente (+15 min recojo)</span>
            <span className="font-mono text-green-400">{formatSimDateTime(planEnvioBuscado.entrega)}</span>
          </div>
        </div>
      )}

      {/* T54/T55: filtros por semáforo (almacenes y UT) reflejados en el mapa.
          En la columna izquierda, debajo del reloj/cartel de época, para no
          chocar con "Envíos en vuelo" (columna derecha, crece hacia arriba).
          NO va en la esquina inferior-izquierda: ahí tapa el sur de
          Sudamérica (Argentina/Chile), que el profesor pidió mantener visible;
          por eso el tope de altura queda acotado para no llegar a esa esquina. */}
      <div className="absolute top-[23rem] left-3 z-[1000] bg-slate-900/92 backdrop-blur border border-slate-700 rounded-xl shadow-lg w-44">
        <button
          onClick={() => setFiltrosAbiertos(a => !a)}
          className="w-full px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors text-left"
        >
          {filtrosAbiertos ? 'Filtros ▴' : 'Filtros ▾'}
        </button>
        {filtrosAbiertos && (
          <div className="px-3 pb-3 max-h-64 overflow-y-auto">
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
      title={marcado ? 'Haz clic para ocultar en el mapa' : 'Haz clic para mostrar en el mapa'}>
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
