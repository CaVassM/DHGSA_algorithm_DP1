import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Polyline, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import NavBar from '../components/NavBar'
import PanelListasDiaADia from '../components/PanelListasDiaADia'
import { getAirports, getEnviosDiariosConRuta, getEstadoDiario, cancelarVueloDiario } from '../services/api'
import { SEMAFORO_COLORES, getSemaforoPorOcupacion } from '../data/aeropuertos'

// Mapa de operaciones día a día.
//
// Pantalla SEPARADA de la de registro, como pide el enunciado: aquella es para
// el empleado que solo recepciona maletas, esta es para ver la operación. Aquí
// se elige un envío y se dibujan todas sus rutas de manera gráfica.
//
// Visualmente comparte look&feel con MapaMundi (el mapa en vivo de la
// simulación 5D): mismos íconos de aeropuerto/avión y el mismo panel de reloj
// en la esquina, para que el evaluador vea "el mismo mapa" en las dos
// pantallas. Lo que NO se comparte es el motor: aquí no hay reproductor ni
// reloj simulado — el tiempo es el real, y TODOS los vuelos actualmente en
// el aire (de cualquier envío, no solo el elegido en la lista) se dibujan a
// la vez, agrupados por vuelo físico igual que hace MapaMundi con sus UT.

const CENTRO = [10, -20]
const ZOOM = 2

/** Ángulo de rumbo (grados) entre dos puntos, para orientar el ícono del avión. */
function getHeadingAngle(from, to) {
  const dx = to.lng - from.lng
  const dy = to.lat - from.lat
  return Math.atan2(-dy, dx) * (180 / Math.PI)
}

/**
 * Colores del avión según % de ocupación — MISMO semáforo que usa MapaMundi
 * para sus UT (gris vacío, verde, ámbar >=60%, rojo >85%). Es "el modelo"
 * pedido: un avión de día a día debe leerse igual que uno del mapa en vivo.
 */
function getPlaneColors(pct) {
  if (pct <= 0) return { fill: '#94a3b8', stroke: '#cbd5e1' }
  if (pct > 85) return { fill: '#f87171', stroke: '#fecaca' }
  if (pct >= 60) return { fill: '#fbbf24', stroke: '#fde68a' }
  return { fill: '#4ade80', stroke: '#bbf7d0' }
}

/** Nombre del color de semáforo (para el panel de filtros), mismos umbrales que arriba. */
function getPlaneSemaforo(pct) {
  if (pct <= 0) return 'vacio'
  if (pct > 85) return 'rojo'
  if (pct >= 60) return 'ambar'
  return 'verde'
}

// Alterna un color en un Set (sin mutar el original) — igual que en MapaMundi.
function toggleSet(set, color) {
  const next = new Set(set)
  if (next.has(color)) next.delete(color); else next.add(color)
  return next
}

const SEMAFORO_FILTRO = [
  { color: 'vacio', hex: '#94a3b8', label: 'Vacío' },
  { color: 'verde', hex: '#4ade80', label: 'Baja carga' },
  { color: 'ambar', hex: '#fbbf24', label: 'Carga media' },
  { color: 'rojo', hex: '#f87171', label: 'Carga alta' },
]

// Cacheados: sin esto, el mapa se re-renderiza cada segundo (reloj en vivo) y
// cada render creaba un ícono nuevo, forzando a Leaflet a reemplazar el DOM
// del marcador — lo que deja los tooltips de hover pegados abiertos.
const avionIconCache = new Map()
/** Avión en pleno vuelo — mismo dibujo (SVG) y misma firma que MapaMundi. */
function crearIconoAvion({ fill, stroke, angle, count }) {
  const key = `${fill}|${stroke}|${angle.toFixed(0)}|${count}`
  const cached = avionIconCache.get(key)
  if (cached) return cached
  const badge = count > 1 ? `<div class="tasf-plane-badge">${count}</div>` : ''
  const icon = L.divIcon({
    className: 'tasf-plane-icon-wrapper',
    html: `
      <div class="tasf-plane-icon" style="--plane-rotation:${angle.toFixed(1)}deg;">
        <svg viewBox="-8 -8 16 16" width="26" height="26" aria-hidden="true">
          <path
            d="M 7,0 L 2,-1.6 L 0,-5 L -2,-2.6 L -3.6,-3.5 L -4.6,-2 L -5,-1 L -5,1 L -4.6,2 L -3.6,3.5 L -2,2.6 L 0,5 L 2,1.6 Z"
            fill="${fill}" stroke="${stroke}" stroke-width="1"
          />
        </svg>
        ${badge}
      </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
  avionIconCache.set(key, icon)
  return icon
}

const aeropuertoIconCache = new Map()
/**
 * Aeropuerto (mismo círculo + silueta de avión que MapaMundi). Con etiqueta
 * opcional debajo, para los puntos de la ruta seleccionada (origen/escala/
 * destino), que necesitan el ICAO a la vista sin depender del tooltip.
 */
function crearIconoAeropuerto(fill, etiqueta) {
  const key = `${fill}|${etiqueta ?? ''}`
  const cached = aeropuertoIconCache.get(key)
  if (cached) return cached
  const label = etiqueta
    ? `<div style="margin-top:2px;font:600 10px/1 ui-monospace,monospace;color:#e2e8f0;text-shadow:0 1px 3px #020617;white-space:nowrap;">${etiqueta}</div>`
    : ''
  const icon = L.divIcon({
    className: 'tasf-airport-icon-wrapper',
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div class="tasf-airport-icon" style="--ap-fill:${fill};">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <circle cx="12" cy="12" r="11" fill="${fill}" stroke="#ffffff" stroke-width="2"/>
            <path fill="#0f172a" transform="translate(4.6 4.6) scale(0.62)"
              d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>
          </svg>
        </div>
        ${label}
      </div>`,
    iconSize: etiqueta ? [22, 38] : [22, 22],
    iconAnchor: [11, 11],
  })
  aeropuertoIconCache.set(key, icon)
  return icon
}

/** Posición actual de la maleta cuando NO está volando: anillo pulsante. */
function iconoMaleta(color) {
  return L.divIcon({
    className: 'tasf-daily-bag',
    html: `<div class="tasf-daily-bag-dot" style="--bag-color:${color};"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

const COLOR_ORIGEN = '#22c55e'
const COLOR_ESCALA = '#f59e0b'
const COLOR_DESTINO = '#3b82f6'
const COLOR_NEUTRO = '#475569'

function hhmm(iso) {
  return iso ? String(iso).slice(11, 16) : '—'
}

/** "18:37 GMT-5 (UTC 23:37)" — para no tener que convertir husos a mano en
 * ningún cartel del mapa. */
function horaConUtc(local, gmt, utc) {
  return `${hhmm(local)} ${gmt ?? ''} (UTC ${hhmm(utc)})`
}

function fechaHora(iso) {
  return iso ? String(iso).slice(5, 16).replace('T', ' ') : '—'
}

function hhmmss(d) {
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** "2026-07-27" — fecha del reloj UTC en vivo, para el panel "Operación en vivo". */
function fechaCorta(d) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * "Ahora" en la misma convención en que llegan las fechas del backend.
 *
 * El backend manda LocalDateTime en UTC, es decir sin sufijo de zona
 * ("2026-07-26T00:01"), y el navegador las interpreta como hora local. Comparar
 * eso con `new Date()` desplazaría todo por el huso del equipo — en Lima, cinco
 * horas: una maleta en vuelo parecería no haber salido.
 */
function ahoraComoUtc() {
  const n = new Date()
  // Se construye la fecha a partir de los campos UTC actuales, leídos luego como
  // locales — la misma lectura que hizo el navegador con las cadenas sin zona
  // del backend. Explícito a propósito: hacerlo con aritmética de offsets
  // invita a equivocarse de signo.
  return new Date(
    n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(),
    n.getUTCHours(), n.getUTCMinutes(), n.getUTCSeconds(),
  )
}

/** "2h 9min", "45min" — para cuentas atrás legibles. */
function duracion(minutos) {
  const m = Math.max(0, Math.round(minutos))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h ${m % 60}min`
}

/**
 * Dónde está la maleta AHORA.
 *
 * En la operación día a día el tiempo es el real: un vuelo tarda las horas que
 * tarda, así que animar el avión no dice nada (avanza un píxel cada varios
 * minutos). Lo que sí importa, y es lo que pregunta cualquiera que mire el mapa,
 * es en qué punto del viaje va cada envío: si todavía está en el almacén de
 * origen, volando un tramo, esperando una conexión o ya entregada.
 *
 * Se calcula sobre las horas UTC de los tramos, que es la única línea de tiempo
 * comparable cuando la ruta cruza husos.
 */
function estadoDeLaMaleta(envio, ahoraUtc) {
  const tramos = envio?.tramos ?? []
  if (tramos.length === 0) return { fase: 'sin-ruta', etiqueta: 'Sin ruta', color: '#64748b' }

  const t0 = new Date(tramos[0].salidaUtc)
  if (Number.isNaN(t0.getTime())) {
    return { fase: 'sin-ruta', etiqueta: 'Sin horario', color: '#64748b' }
  }
  if (ahoraUtc < t0) {
    return {
      fase: 'en-almacen',
      etiqueta: `En almacén ${tramos[0].origenIcao}`,
      detalle: `sale en ${duracion((t0 - ahoraUtc) / 60000)}`,
      color: '#22c55e',
      tramoActual: -1,
    }
  }

  for (let i = 0; i < tramos.length; i++) {
    const salida = new Date(tramos[i].salidaUtc)
    const llegada = new Date(tramos[i].llegadaUtc)

    if (ahoraUtc >= salida && ahoraUtc < llegada) {
      const progreso = (ahoraUtc - salida) / (llegada - salida)
      return {
        fase: 'en-vuelo',
        etiqueta: `En vuelo ${tramos[i].origenIcao} → ${tramos[i].destinoIcao}`,
        detalle: `${Math.round(progreso * 100)}% · llega ${hhmm(tramos[i].llegadaLocal)} ${tramos[i].gmtDestino}`,
        color: '#3b82f6',
        tramoActual: i,
        progreso,
      }
    }

    // Entre la llegada de este tramo y la salida del siguiente: escala.
    const siguiente = tramos[i + 1]
    if (siguiente && ahoraUtc >= llegada && ahoraUtc < new Date(siguiente.salidaUtc)) {
      const espera = (new Date(siguiente.salidaUtc) - ahoraUtc) / 60000
      return {
        fase: 'en-escala',
        etiqueta: `En escala · ${tramos[i].destinoIcao}`,
        detalle: `conecta en ${duracion(espera)}`,
        color: '#f59e0b',
        tramoActual: i,
      }
    }
  }

  return {
    fase: 'entregada',
    etiqueta: 'Entregada',
    detalle: `${fechaHora(envio.entregaLocalDestino)} ${envio.gmtDestino}`,
    color: '#94a3b8',
    tramoActual: tramos.length,
  }
}

export default function MapaDiaADia() {
  const [aeropuertos, setAeropuertos] = useState([])
  const [envios, setEnvios] = useState([])
  // ?envio=DIA-3 llega desde la pantalla de registro ("ver en el mapa"): abre
  // el mapa con ese envío ya elegido, sin tener que buscarlo en la lista.
  const [searchParams] = useSearchParams()
  const [seleccionado, setSeleccionado] = useState(() => searchParams.get('envio'))
  // Vuelo (plantilla, sin "@fecha") resaltado desde la pestaña "Vuelos" del
  // panel — igual que F07/F08 en MapaMundi: se puede ubicar una UT en el mapa
  // sin necesidad de que un envío concreto vaya montado en ella.
  const [vueloResaltado, setVueloResaltado] = useState(null)
  // Almacén elegido desde la pestaña "Almacenes" del panel: igual que el envío
  // o el vuelo resaltado, es excluyente con los otros dos — solo puede haber
  // un modo de foco activo a la vez en el mapa.
  const [almacenSeleccionado, setAlmacenSeleccionado] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  // Estado en vivo de almacenes y flota (capacidades, ocupación) — alimenta las
  // pestañas "Almacenes" y "Vuelos" del panel, además de la ficha de detalle.
  const [estado, setEstado] = useState(null)
  // Panel lateral completo: ocultable para dejar el mapa a pantalla completa.
  const [sidebarColapsado, setSidebarColapsado] = useState(false)

  // Instancia de Leaflet: hace falta para interpolar la posición del avión en
  // el MISMO espacio en que Leaflet dibuja la línea (píxeles de pantalla), no
  // en grados lat/lng. Interpolar en grados se curva al proyectar a Mercator
  // y, en rutas largas (sobre todo las que cruzan el antimeridiano, ±180°),
  // el avión terminaba dibujado lejos de su propia línea — con pocos vuelos
  // no se notaba, pero con cientos de vuelos de larga distancia sí. Mismo
  // arreglo que ya usa MapaMundi.
  const [mapInstance, setMapInstance] = useState(null)

  // T54/T55 (adaptado): filtros del mapa — mismo panel que MapaMundi: semáforo
  // de aviones (por ocupación del vuelo), semáforo de almacenes (por ocupación
  // de la sede) y continente. Un color/continente "apagado" oculta del todo
  // esos aeropuertos y vuelos (no solo los atenúa).
  const [utsOcultas, setUtsOcultas] = useState(() => new Set())
  const [almacenesOcultos, setAlmacenesOcultos] = useState(() => new Set())
  const [continentesOcultos, setContinentesOcultos] = useState(() => new Set())
  const [filtroSemaforoAbierto, setFiltroSemaforoAbierto] = useState(false)

  // Cancelación desde el propio mapa. La prueba encadena "seleccionar un envío,
  // verlo en el mapa, cancelar un vuelo y comprobar la reasignación": mandar a
  // otra pantalla justo en ese punto obligaría a saltar de pestaña y volver,
  // con el mapa perdiendo el envío elegido por el camino.
  const [cancelando, setCancelando] = useState(null)
  const [avisoCancelacion, setAvisoCancelacion] = useState(null)

  // Reloj en UTC: es contra el que se sitúan los tramos, que vienen fechados en
  // esa misma línea de tiempo. Se refresca cada segundo — igual que el reloj en
  // vivo de MapaMundi — para que los aviones en curso se vean avanzar y el panel
  // de la esquina sirva de referencia horaria real durante la operación.
  //
  // Las fechas del backend llegan SIN zona ("2026-07-26T00:01"), y el navegador
  // las interpreta como hora local. Para compararlas hay que llevar el "ahora"
  // a esa misma convención: la hora UTC actual, leída como si fuera local.
  const [ahoraUtc, setAhoraUtc] = useState(ahoraComoUtc)
  const [ahoraSistema, setAhoraSistema] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => {
      setAhoraUtc(ahoraComoUtc())
      setAhoraSistema(new Date())
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const refrescar = useCallback(async () => {
    try {
      const lista = await getEnviosDiariosConRuta()
      setEnvios(lista ?? [])
      setError(null)
    } catch {
      setError('No se pudieron cargar los envíos. ¿El backend está corriendo?')
    } finally {
      setCargando(false)
    }
  }, [])

  // Capacidades de almacenes y flota — usadas por las pestañas "Almacenes" y
  // "Vuelos" del panel lateral. Se refresca junto con los envíos.
  const refrescarEstado = useCallback(async () => {
    try {
      setEstado(await getEstadoDiario())
    } catch {
      // El panel de almacenes/vuelos queda vacío; el resto de la pantalla sigue.
    }
  }, [])

  /**
   * Cancela la salida de un tramo y refresca en el acto.
   *
   * El identificador del grafo es "VL-SPIM-SCEL-0721@2026-07-26"; el backend
   * espera solo la plantilla, y él resuelve qué salida concreta cae dentro del
   * margen de una hora.
   */
  const cancelarTramo = useCallback(async vueloId => {
    const plantilla = String(vueloId).split('@')[0]
    setCancelando(plantilla)
    setAvisoCancelacion(null)
    try {
      const r = await cancelarVueloDiario(plantilla)
      setAvisoCancelacion({ ok: r.aplicada, texto: r.mensaje, plantilla })
      await Promise.all([refrescar(), refrescarEstado()])
    } catch {
      setAvisoCancelacion({ ok: false, texto: 'No se pudo cancelar el vuelo.', plantilla })
    } finally {
      setCancelando(null)
    }
  }, [refrescar, refrescarEstado])

  // Los tres modos de foco del mapa (envío / vuelo / almacén) son excluyentes
  // entre sí: elegir uno apaga los otros dos, igual que ya hace MapaMundi con
  // su búsqueda de envío y su resaltado de UT.
  const seleccionarEnvioMapa = useCallback(id => {
    setSeleccionado(id)
    if (id) { setVueloResaltado(null); setAlmacenSeleccionado(null) }
  }, [])
  const resaltarVueloMapa = useCallback(id => {
    setVueloResaltado(id)
    if (id) { setSeleccionado(null); setAlmacenSeleccionado(null) }
  }, [])
  const seleccionarAlmacenMapa = useCallback(icao => {
    setAlmacenSeleccionado(icao)
    if (icao) { setSeleccionado(null); setVueloResaltado(null) }
  }, [])

  /** Deja el mapa como al entrar: sin foco elegido y sin filtros de semáforo o
   * continente activos. Botón "Limpiar filtros" del panel. */
  const limpiarTodoElFoco = useCallback(() => {
    setSeleccionado(null)
    setVueloResaltado(null)
    setAlmacenSeleccionado(null)
    setUtsOcultas(new Set())
    setAlmacenesOcultos(new Set())
    setContinentesOcultos(new Set())
  }, [])

  useEffect(() => {
    let vivo = true
    getAirports(0, 500)
      .then(p => { if (vivo) setAeropuertos(p?.content ?? []) })
      .catch(() => {})
    refrescar()
    refrescarEstado()
    // La operación es continua y hay varias terminales registrando a la vez:
    // sin refresco periódico, este visualizador se quedaría con la foto del
    // momento en que se abrió.
    const id = setInterval(() => { refrescar(); refrescarEstado() }, 5000)
    return () => { vivo = false; clearInterval(id) }
  }, [refrescar, refrescarEstado])

  const coords = useMemo(() => {
    const m = {}
    aeropuertos.forEach(a => { m[a.codigoIcao] = { lat: a.latitud, lng: a.longitud, ciudad: a.ciudad } })
    return m
  }, [aeropuertos])

  // Estado (fase/color/detalle) de CADA envío, no solo del elegido: alimenta la
  // lista de la izquierda y el agrupado de vuelos activos de más abajo. Un solo
  // cálculo por envío y por tick de reloj, en vez de repetirlo en cada sitio
  // que lo necesita. Declarado ANTES de `ocupacionPorAlmacen`: ese cálculo lo
  // usa, y estar declarado después causaba "Cannot access before initialization".
  const estadosPorEnvio = useMemo(() => {
    const m = new Map()
    envios.forEach(e => m.set(e.envioId, estadoDeLaMaleta(e, ahoraUtc)))
    return m
  }, [envios, ahoraUtc])

  // Ocupación de almacén por aeropuerto: lo único que ocupa espacio físico en
  // una sede en día a día es una maleta en almacén de origen (todavía no salió)
  // o en escala (ya llegó a una conexión, esperando el siguiente tramo) — volando
  // no ocupa almacén de nadie. Mismo cálculo que usa la pestaña "Almacenes" del
  // panel, repetido aquí porque el filtro de colores necesita el semáforo por
  // aeropuerto para poder ocultarlos en el mapa.
  const ocupacionPorAlmacen = useMemo(() => {
    const resultado = {}
    envios.forEach(envio => {
      const est = estadosPorEnvio.get(envio.envioId)
      if (!est) return
      if (est.fase === 'en-almacen') {
        const icao = envio.tramos?.[0]?.origenIcao
        if (icao) resultado[icao] = (resultado[icao] ?? 0) + (envio.cantidadMaletas ?? 0)
      } else if (est.fase === 'en-escala') {
        const icao = envio.tramos?.[est.tramoActual]?.destinoIcao
        if (icao) resultado[icao] = (resultado[icao] ?? 0) + (envio.cantidadMaletas ?? 0)
      }
    })
    return resultado
  }, [envios, estadosPorEnvio])

  /** Color de semáforo del almacén de cada aeropuerto (mismos 4 colores/umbrales
   * que MapaMundi usa para sus almacenes — `getSemaforoPorOcupacion`). */
  const semaforoPorAeropuerto = useMemo(() => {
    const m = new Map()
    aeropuertos.forEach(a => {
      const ocupado = ocupacionPorAlmacen[a.codigoIcao] ?? 0
      const capacidad = Number(a.capacidadAlmacen ?? 0)
      const pct = capacidad > 0 ? (ocupado / capacidad) * 100 : 0
      m.set(a.codigoIcao, getSemaforoPorOcupacion(pct))
    })
    return m
  }, [aeropuertos, ocupacionPorAlmacen])

  const continentes = useMemo(
    () => Array.from(new Set(aeropuertos.map(a => a.continente).filter(Boolean))).sort(),
    [aeropuertos],
  )

  /**
   * ICAOs ocultos por el filtro de almacenes o de continente. Regla del
   * profesor (la misma que ya sigue MapaMundi): ocultar un aeropuerto oculta
   * también sus vuelos — no tendría sentido ver un avión saliendo de un
   * aeropuerto que el propio filtro dice que no querés ver.
   */
  const icaosOcultos = useMemo(() => {
    const set = new Set()
    aeropuertos.forEach(a => {
      const semAlmacen = semaforoPorAeropuerto.get(a.codigoIcao)
      if (almacenesOcultos.has(semAlmacen) || continentesOcultos.has(a.continente)) {
        set.add(a.codigoIcao)
      }
    })
    return set
  }, [aeropuertos, semaforoPorAeropuerto, almacenesOcultos, continentesOcultos])

  /**
   * TODOS los vuelos que están en el aire ahora mismo, de cualquier envío —
   * no solo el seleccionado en la lista. Es el pedido central del evaluador:
   * el mapa de operaciones debe verse como el mapa en vivo, con la flota
   * completa en curso a la vista, no un envío a la vez.
   *
   * Agrupados por vuelo FÍSICO (tramo.vueloId, que ya incluye la fecha de
   * salida): si dos envíos comparten el mismo avión, se funden en un solo
   * ícono con el badge de conteo, igual que hace MapaMundi con sus UT.
   */
  const vuelosActivos = useMemo(() => {
    const grupos = new Map()
    envios.forEach(e => {
      const est = estadosPorEnvio.get(e.envioId)
      if (!est || est.fase !== 'en-vuelo') return
      const t = e.tramos?.[est.tramoActual]
      if (!t) return
      let g = grupos.get(t.vueloId)
      if (!g) {
        g = {
          key: t.vueloId,
          vueloId: t.vueloId,
          origenIcao: t.origenIcao,
          destinoIcao: t.destinoIcao,
          progreso: est.progreso,
          llegadaLocal: t.llegadaLocal,
          llegadaUtc: t.llegadaUtc,
          gmtDestino: t.gmtDestino,
          capacidad: t.capacidad ?? 0,
          count: 0,
          maletas: 0,
          envioIds: [],
          seleccionado: false,
        }
        grupos.set(t.vueloId, g)
      }
      g.count += 1
      g.maletas += e.cantidadMaletas ?? 0
      g.envioIds.push(e.envioId)
      if (e.envioId === seleccionado) g.seleccionado = true
    })
    // % de ocupación del vuelo FÍSICO (todas las maletas que lleva, no solo las
    // de un envío): mismo cálculo que MapaMundi usa para su semáforo de UT.
    return Array.from(grupos.values()).map(g => ({
      ...g,
      ocupacionPct: g.capacidad > 0 ? (g.maletas / g.capacidad) * 100 : 0,
    }))
  }, [envios, estadosPorEnvio, seleccionado])

  /**
   * C27 (adaptado): vuelos VACÍOS que están en el aire ahora mismo. `vuelosActivos`
   * solo sale de los envíos, así que un vuelo que despegó sin carga asignada
   * nunca aparecía — el enunciado pide poder verlo igual, en blanco/gris (el
   * color "vacío" del semáforo). Sale del catálogo en vivo (`estado.vuelos`),
   * que trae TODAS las salidas con su ocupación real, no solo las que llevan
   * envíos de esta operación.
   */
  const vuelosVaciosEnAire = useMemo(() => {
    if (!estado?.vuelos) return []
    const conCarga = new Set(vuelosActivos.map(v => v.vueloId))
    return estado.vuelos
      .filter(v => !conCarga.has(v.vueloId) && (v.ocupado ?? 0) === 0 && !v.cancelado
        && v.salidaUtc && v.llegadaUtc)
      .map(v => ({ ...v, salida: new Date(v.salidaUtc), llegada: new Date(v.llegadaUtc) }))
      .filter(v => v.salida <= ahoraUtc && ahoraUtc < v.llegada)
      .map(v => ({
        key: v.vueloId,
        vueloId: v.vueloId,
        origenIcao: v.origenIcao,
        destinoIcao: v.destinoIcao,
        progreso: (ahoraUtc - v.salida) / (v.llegada - v.salida),
        llegadaLocal: v.llegadaLocal,
        llegadaUtc: v.llegadaUtc,
        gmtDestino: v.gmtDestino,
        capacidad: v.capacidad,
        count: 0,
        maletas: 0,
        envioIds: [],
        seleccionado: false,
        ocupacionPct: 0,
        vacio: true,
      }))
  }, [estado, vuelosActivos, ahoraUtc])

  // Todos los aviones que se dibujan en el mapa: los que llevan carga
  // (`vuelosActivos`) más los vacíos. Un solo arreglo para no repetir el
  // mismo bloque de render dos veces.
  const avionesEnAire = useMemo(
    () => [...vuelosActivos, ...vuelosVaciosEnAire],
    [vuelosActivos, vuelosVaciosEnAire],
  )

  /**
   * Qué aviones se DIBUJAN en el mapa: todos, salvo que haya un foco activo
   * elegido desde el panel — envío ("Envíos"), vuelo ("Vuelos") o almacén
   * ("Almacenes") — en cuyo caso el resto de la flota se oculta para dejar
   * la vista despejada con solo lo que corresponde a ese foco. `avionesEnAire`
   * (sin filtrar) se sigue usando para los contadores del panel de arriba, que
   * muestran el total de la operación, no solo lo que se está mirando.
   */
  const avionesVisibles = useMemo(() => {
    if (seleccionado) return avionesEnAire.filter(v => v.envioIds.includes(seleccionado))
    if (vueloResaltado) return avionesEnAire.filter(v => v.vueloId.split('@')[0] === vueloResaltado)
    if (almacenSeleccionado) {
      return avionesEnAire.filter(v => v.origenIcao === almacenSeleccionado || v.destinoIcao === almacenSeleccionado)
    }
    return avionesEnAire
  }, [avionesEnAire, seleccionado, vueloResaltado, almacenSeleccionado])

  /**
   * Salidas del vuelo resaltado desde la pestaña "Vuelos" del panel (F07/F08
   * de MapaMundi, adaptado): un vuelo se puede ubicar en el mapa aunque no
   * lleve ningún envío montado todavía, usando el catálogo en vivo
   * (`estado.vuelos`) en vez de depender de las rutas de los envíos.
   */
  const vuelosResaltadosLinea = useMemo(() => {
    if (!vueloResaltado || !estado?.vuelos) return []
    return estado.vuelos.filter(v => v.vueloId.split('@')[0] === vueloResaltado)
  }, [vueloResaltado, estado])

  /**
   * Vuelos que tocan el almacén elegido desde la pestaña "Almacenes" del
   * panel: los que ENTRAN (destino = ese almacén) y los que SALEN (origen =
   * ese almacén), con su ruta completa — hayan despegado o no todavía. Sale
   * del catálogo en vivo (`estado.vuelos`), no de `avionesEnAire`: ese último
   * solo trae lo que ya está en el aire, y acá se quiere ver también lo que
   * está por salir/llegar.
   */
  const vuelosDelAlmacen = useMemo(() => {
    if (!almacenSeleccionado || !estado?.vuelos) return []
    return estado.vuelos.filter(v => v.origenIcao === almacenSeleccionado || v.destinoIcao === almacenSeleccionado)
  }, [almacenSeleccionado, estado])

  // `coords` se reconstruye cada refresco de aeropuertos (cada 5s) aunque el
  // dato no haya cambiado; leerlo por ref evita que el efecto de zoom de abajo
  // se dispare de nuevo en cada refresco y "empuje" la vista mientras el
  // usuario ya la movió a mano.
  const coordsRef = useRef(coords)
  useEffect(() => { coordsRef.current = coords }, [coords])

  // Zoom al almacén elegido desde la pestaña "Almacenes" — mismo gesto que
  // `enfocarAeropuerto` de MapaMundi.
  useEffect(() => {
    if (!almacenSeleccionado || !mapInstance) return
    const c = coordsRef.current[almacenSeleccionado]
    if (!c) return
    mapInstance.flyTo([c.lat, c.lng], Math.max(mapInstance.getZoom(), 5), { duration: 0.8 })
  }, [almacenSeleccionado, mapInstance])

  // Zoom al vuelo resaltado desde la pestaña "Vuelos": si ya está en el aire,
  // se centra en su posición actual; si todavía no despegó, en el punto medio
  // de su ruta. Solo debe reaccionar al CLICK del panel (cambio de
  // `vueloResaltado`), no en cada tick del reloj — por eso no lleva
  // `avionesEnAire`/`estado`/`coords` en las dependencias.
  useEffect(() => {
    if (!vueloResaltado || !mapInstance) return
    const c = coordsRef.current
    const enAire = avionesEnAire.find(v => v.vueloId.split('@')[0] === vueloResaltado)
    if (enAire) {
      const a = c[enAire.origenIcao]
      const b = c[enAire.destinoIcao]
      if (a && b) {
        const lat = a.lat + (b.lat - a.lat) * enAire.progreso
        const lng = a.lng + (b.lng - a.lng) * enAire.progreso
        mapInstance.flyTo([lat, lng], Math.max(mapInstance.getZoom(), 4), { duration: 0.8 })
      }
      return
    }
    const v = estado?.vuelos?.find(x => x.vueloId.split('@')[0] === vueloResaltado)
    if (v) {
      const a = c[v.origenIcao]
      const b = c[v.destinoIcao]
      if (a && b) {
        mapInstance.flyTo([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2], Math.max(mapInstance.getZoom(), 4), { duration: 0.8 })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vueloResaltado, mapInstance])

  const envio = envios.find(e => e.envioId === seleccionado) ?? null
  const estadoActual = envio ? estadosPorEnvio.get(envio.envioId) : null

  /**
   * Punto del mapa donde está la maleta ELEGIDA cuando NO está volando (en
   * almacén o en escala). Mientras vuela ya se ve como avión en
   * `vuelosActivos` — duplicar el marcador ahí solo generaría dos íconos
   * superpuestos sobre el mismo tramo.
   */
  const posicionMaleta = useMemo(() => {
    if (!envio || !estadoActual) return null
    const tramos = envio.tramos ?? []

    if (estadoActual.fase === 'en-almacen') {
      const c = coords[tramos[0]?.origenIcao]
      return c ? { lat: c.lat, lng: c.lng } : null
    }
    if (estadoActual.fase === 'en-escala') {
      const c = coords[tramos[estadoActual.tramoActual]?.destinoIcao]
      return c ? { lat: c.lat, lng: c.lng } : null
    }
    return null
  }, [envio, estadoActual, coords])

  // Aeropuertos que toca la ruta seleccionada, con el papel que cumplen: el
  // color distingue de un vistazo dónde empieza, dónde hace escala y dónde
  // termina el viaje de la maleta.
  const puntosRuta = useMemo(() => {
    if (!envio) return []
    const puntos = []
    envio.tramos?.forEach((t, i) => {
      if (i === 0) puntos.push({ icao: t.origenIcao, color: COLOR_ORIGEN, papel: 'origen' })
      const esUltimo = i === envio.tramos.length - 1
      puntos.push({
        icao: t.destinoIcao,
        color: esUltimo ? COLOR_DESTINO : COLOR_ESCALA,
        papel: esUltimo ? 'destino' : 'escala',
      })
    })
    return puntos
  }, [envio])

  /**
   * Cuando no hay envío elegido pero SÍ un vuelo resaltado desde el panel,
   * igual conviene marcar sus dos puntas en el mapa (si hay envío elegido,
   * su ruta manda: `puntosRuta` ya cubre más tramos que un solo vuelo).
   */
  const puntosVueloResaltado = useMemo(() => {
    if (puntosRuta.length > 0) return []
    const v = vuelosResaltadosLinea[0]
    if (!v) return []
    return [
      { icao: v.origenIcao, color: COLOR_ORIGEN, papel: 'origen' },
      { icao: v.destinoIcao, color: COLOR_DESTINO, papel: 'destino' },
    ]
  }, [puntosRuta, vuelosResaltadosLinea])

  const puntosDestacados = puntosRuta.length > 0 ? puntosRuta : puntosVueloResaltado
  const icaosEnRuta = new Set(puntosDestacados.map(p => p.icao))

  const enviosVolando = vuelosActivos.reduce((acc, v) => acc + v.count, 0)

  return (
    <div className="h-screen flex flex-col bg-[#0f172a] overflow-hidden">
      <NavBar />
      <div className="flex flex-1 overflow-hidden relative">

        {/* Panel de control: almacenes, vuelos y envíos en vivo — misma
            estructura que PanelListas del Dashboard, adaptada a la operación
            día a día. Ocultable por completo (deja el mapa a pantalla
            completa) independientemente de sus propios filtros internos,
            que también se pliegan aparte. */}
        {!sidebarColapsado && (
          <aside className="w-96 shrink-0 bg-slate-900 border-r border-slate-700 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-700">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Operación día a día
                </h2>
                <button
                  type="button"
                  onClick={limpiarTodoElFoco}
                  title="Quita el envío/vuelo/almacén elegido y los filtros de semáforo y continente"
                  className="shrink-0 px-2 py-1 rounded border border-slate-600 bg-slate-800 text-[10px] text-slate-300 hover:text-white hover:border-blue-500/60 transition-colors"
                >
                  Limpiar filtros
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Almacenes, vuelos y envíos en vivo. Elegí un envío, un vuelo o
                un almacén para verlo resaltado y centrado en el mapa.
              </p>
            </div>

            {cargando ? (
              <p className="p-4 text-sm text-slate-500">Cargando…</p>
            ) : error ? (
              <p className="p-4 text-sm text-red-400">{error}</p>
            ) : (
              <PanelListasDiaADia
                aeropuertos={aeropuertos}
                envios={envios}
                estadosPorEnvio={estadosPorEnvio}
                estado={estado}
                ahoraUtc={ahoraUtc}
                seleccionado={seleccionado}
                onSelectShipment={seleccionarEnvioMapa}
                vueloResaltado={vueloResaltado}
                onSelectFlight={resaltarVueloMapa}
                almacenSeleccionado={almacenSeleccionado}
                onSelectAlmacen={seleccionarAlmacenMapa}
                onCancelarVuelo={cancelarTramo}
                cancelando={cancelando}
                avisoCancelacion={avisoCancelacion}
              />
            )}

            <div className="px-4 py-2 border-t border-slate-700 text-[11px] text-slate-500">
              {envios.length} envío{envios.length === 1 ? '' : 's'} en la jornada · {enviosVolando} en vuelo ahora
            </div>
          </aside>
        )}

        {/* Pestaña para ocultar/mostrar el panel completo. Vive fuera del
            <aside> para poder posicionarla según si está o no colapsado. */}
        <button
          onClick={() => setSidebarColapsado(v => !v)}
          title={sidebarColapsado ? 'Mostrar panel' : 'Ocultar panel'}
          className="absolute top-1/2 -translate-y-1/2 z-[1200] w-5 h-14 flex items-center justify-center rounded-r-lg bg-slate-800 border border-l-0 border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          style={{ left: sidebarColapsado ? 0 : '24rem' }}
        >
          {sidebarColapsado ? '›' : '‹'}
        </button>

        {/* Mapa */}
        <main className="flex-1 relative">
          {/* zoomSnap/zoomDelta a 0.25: por defecto Leaflet salta un nivel
              entero por muesca de rueda, lo que en un mapa mundial pasa de ver
              tres continentes a ver una ciudad. */}
          <MapContainer
            center={CENTRO} zoom={ZOOM} className="w-full h-full" worldCopyJump
            zoomSnap={0.25} zoomDelta={0.25} wheelPxPerZoomLevel={200}
            ref={setMapInstance}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution="&copy; OpenStreetMap &copy; CARTO"
            />

            {/* Aeropuertos que no participan en la ruta elegida: se dejan como
                referencia geográfica, con el mismo ícono que usa el mapa en
                vivo (círculo + silueta de avión), coloreado por el semáforo de
                ocupación de su almacén — igual que MapaMundi. El filtro de
                almacenes/continente los oculta del todo, no solo los atenúa. */}
            {aeropuertos.map(a => {
              if (icaosEnRuta.has(a.codigoIcao) || icaosOcultos.has(a.codigoIcao)) return null
              const sem = semaforoPorAeropuerto.get(a.codigoIcao)
              return (
                <Marker
                  key={a.codigoIcao}
                  position={[a.latitud, a.longitud]}
                  icon={crearIconoAeropuerto(SEMAFORO_COLORES[sem] ?? COLOR_NEUTRO)}
                >
                  <Tooltip direction="top" className="tasf-tooltip" opacity={1}>
                    <span className="text-xs">{a.codigoIcao} · {a.ciudad}</span>
                  </Tooltip>
                </Marker>
              )
            })}

            {/* Tramos del envío seleccionado, en orden de vuelo. Mismo criterio
                que MapaMundi para sus rutas ("revealAt"): un tramo que TODAVÍA
                no despegó no se dibuja — mostrarlo daría a entender que ya hay
                un vuelo en curso cuando en realidad ni salió. Se muestra recién
                al llegar su hora de salida (o si fue cancelado, que sí es
                información vigente aunque su salida sea futura). */}
            {envio?.tramos?.map((t, i) => {
              const a = coords[t.origenIcao]
              const b = coords[t.destinoIcao]
              if (!a || !b) return null
              const yaSalio = t.salidaUtc && ahoraUtc >= new Date(t.salidaUtc)
              // El tramo que la maleta está volando ahora se destaca; los que ya
              // quedaron atrás se atenúan. Así se lee de un vistazo por dónde va
              // el viaje sin necesidad de animar nada.
              const enCurso = estadoActual?.fase === 'en-vuelo' && estadoActual.tramoActual === i
              const yaPasado = estadoActual?.tramoActual != null && i < estadoActual.tramoActual
              // Un tramo que TODAVÍA no despega no se pinta como "vuelo en
              // curso" (sería falso), pero tampoco se oculta del todo: se
              // muestra como línea fina punteada, la misma "vista previa" de
              // por dónde va a ir el avión que usa MapaMundi para sus rutas
              // aún no voladas.
              const pathOptions = t.cancelado
                ? { color: '#ef4444', weight: 3, opacity: 0.9, dashArray: '6 6' }
                : enCurso
                  ? { color: '#60a5fa', weight: 5, opacity: 0.9 }
                  : yaPasado
                    ? { color: '#3b82f6', weight: 3, opacity: 0.35 }
                    : !yaSalio
                      ? { color: '#3b82f6', weight: 1.5, opacity: 0.5, dashArray: '5 7' }
                      : { color: '#3b82f6', weight: 3, opacity: 0.9 }
              return (
                <Polyline
                  key={`${t.vueloId}-${i}`}
                  positions={[[a.lat, a.lng], [b.lat, b.lng]]}
                  pathOptions={pathOptions}
                >
                  <Tooltip sticky className="tasf-tooltip" opacity={1}>
                    <div className="text-xs">
                      <div className="font-bold text-white mb-1">
                        Tramo {i + 1} · {t.origenIcao} → {t.destinoIcao}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400 mb-1">{t.vueloId}</div>
                      <div className="text-slate-300">
                        Sale {horaConUtc(t.salidaLocal, t.gmtOrigen, t.salidaUtc)}
                      </div>
                      <div className="text-slate-300">
                        Llega {horaConUtc(t.llegadaLocal, t.gmtDestino, t.llegadaUtc)}
                      </div>
                      {!yaSalio && !t.cancelado && (
                        <div className="text-slate-400">Todavía no despega (vista previa)</div>
                      )}
                      {t.esperaMinutos > 0 && (
                        <div className="text-amber-300">
                          Espera en {t.origenIcao}: {t.esperaMinutos} min
                        </div>
                      )}
                      {t.cancelado && <div className="text-red-400 mt-1">VUELO CANCELADO</div>}
                    </div>
                  </Tooltip>
                </Polyline>
              )
            })}

            {/* Vuelo resaltado desde la pestaña "Vuelos" del panel: se marca
                con una línea punteada amarilla entre sus dos puntas, exista o
                no un envío montado en él (F07/F08 de MapaMundi). */}
            {vuelosResaltadosLinea.map(v => {
              const a = coords[v.origenIcao]
              const b = coords[v.destinoIcao]
              if (!a || !b) return null
              return (
                <Polyline
                  key={`resaltado-${v.vueloId}`}
                  positions={[[a.lat, a.lng], [b.lat, b.lng]]}
                  pathOptions={{ color: '#facc15', weight: 3, opacity: 0.95, dashArray: '4 8' }}
                >
                  <Tooltip sticky className="tasf-tooltip" opacity={1}>
                    <div className="text-xs">
                      <div className="font-bold text-white mb-1">{v.origenIcao} → {v.destinoIcao}</div>
                      <div className="font-mono text-[10px] text-slate-400 mb-1">{v.vueloId.split('@')[0]}</div>
                      <div className="text-slate-300">
                        Sale {horaConUtc(v.salidaLocal, v.gmtOrigen, v.salidaUtc)}
                      </div>
                      <div className="text-slate-300">
                        Llega {horaConUtc(v.llegadaLocal, v.gmtDestino, v.llegadaUtc)}
                      </div>
                      <div className="text-slate-300">
                        Ocupación: {v.ocupado}/{v.capacidad} ({(v.ocupacionPorcentaje ?? 0).toFixed(1)}%)
                      </div>
                      {v.cancelado && <div className="text-red-400 mt-1">VUELO CANCELADO</div>}
                    </div>
                  </Tooltip>
                </Polyline>
              )
            })}

            {/* Rutas de los vuelos que tocan el almacén elegido desde la
                pestaña "Almacenes": los que ENTRAN (verde, llegan a esa sede)
                y los que SALEN (ámbar, despegan de ella), completa aunque
                todavía no hayan despegado — es la vista "todo lo que pasa por
                esta sede", no solo lo que ya está en el aire. */}
            {vuelosDelAlmacen.map(v => {
              const a = coords[v.origenIcao]
              const b = coords[v.destinoIcao]
              if (!a || !b) return null
              const entra = v.destinoIcao === almacenSeleccionado
              return (
                <Polyline
                  key={`almacen-${v.vueloId}`}
                  positions={[[a.lat, a.lng], [b.lat, b.lng]]}
                  pathOptions={{
                    color: v.cancelado ? '#ef4444' : entra ? '#4ade80' : '#fbbf24',
                    weight: 2.5,
                    opacity: 0.85,
                    dashArray: '4 8',
                  }}
                >
                  <Tooltip sticky className="tasf-tooltip" opacity={1}>
                    <div className="text-xs">
                      <div className="font-bold text-white mb-1">{v.origenIcao} → {v.destinoIcao}</div>
                      <div className="font-mono text-[10px] text-slate-400 mb-1">{v.vueloId.split('@')[0]}</div>
                      <div className={entra ? 'text-green-300' : 'text-amber-300'}>
                        {entra ? 'Entra al almacén' : 'Sale del almacén'}
                      </div>
                      <div className="text-slate-300">
                        Sale {horaConUtc(v.salidaLocal, v.gmtOrigen, v.salidaUtc)}
                      </div>
                      <div className="text-slate-300">
                        Llega {horaConUtc(v.llegadaLocal, v.gmtDestino, v.llegadaUtc)}
                      </div>
                      {v.cancelado && <div className="text-red-400 mt-1">VUELO CANCELADO</div>}
                    </div>
                  </Tooltip>
                </Polyline>
              )
            })}

            {/* Línea de la ruta de CADA avión en curso, sin necesidad de elegir
                nada: es lo que pide el evaluador — entrar y ver de un vistazo
                hacia dónde va cada vuelo que ya está en el aire, no solo el
                seleccionado. Punteada y más tenue que la ruta del envío
                elegido (esa sigue siendo la más marcada). Si hay un envío
                elegido desde la pestaña "Envíos", `avionesVisibles` ya viene
                filtrado a solo ese envío — el resto de la flota se oculta. */}
            {avionesVisibles.map(v => {
              const a = coords[v.origenIcao]
              const b = coords[v.destinoIcao]
              if (!a || !b) return null
              // Mismo filtro por semáforo que el avión, y del mismo modo: oculta
              // del todo, no atenúa — si el avión desaparece, su línea también.
              // También se oculta si el aeropuerto de origen o destino está
              // filtrado (por almacén o continente): ocultar un aeropuerto
              // oculta sus vuelos.
              if (utsOcultas.has(getPlaneSemaforo(v.ocupacionPct))) return null
              if (icaosOcultos.has(v.origenIcao) || icaosOcultos.has(v.destinoIcao)) return null
              return (
                <Polyline
                  key={`linea-${v.key}`}
                  positions={[[a.lat, a.lng], [b.lat, b.lng]]}
                  pathOptions={{
                    color: v.vacio ? '#94a3b8' : '#3b82f6',
                    weight: 2,
                    opacity: 0.55,
                    dashArray: '4 8',
                  }}
                />
              )
            })}

            {/* TODOS los aviones en curso ahora mismo: los que llevan carga (de
                cualquier envío, no solo el elegido) Y los vacíos (despegaron
                sin carga asignada). El pedido del evaluador es ver la flota
                completa en el aire, igual que el mapa en vivo — incluidos los
                vacíos, que ahí también se pintan en el color "vacío" del
                semáforo (blanco/gris), no se omiten. El avión del envío
                elegido, o el que se resaltó desde la pestaña "Vuelos", se
                destaca con un tono más claro y por encima del resto. El panel
                de filtros de abajo puede atenuar por color de semáforo. Con un
                envío elegido desde "Envíos", `avionesVisibles` ya trae solo
                el suyo. */}
            {avionesVisibles.map(v => {
              const a = coords[v.origenIcao]
              const b = coords[v.destinoIcao]
              if (!a || !b) return null
              const sem = getPlaneSemaforo(v.ocupacionPct)
              // El filtro oculta del todo, no solo atenúa: con cientos de
              // vuelos en pantalla, dejar el avión semitransparente seguía
              // estorbando la lectura del mapa.
              if (utsOcultas.has(sem)) return null
              if (icaosOcultos.has(v.origenIcao) || icaosOcultos.has(v.destinoIcao)) return null

              // Posición interpolada en el MISMO espacio en que Leaflet dibuja
              // la línea (píxeles de pantalla), no en grados lat/lng: interpolar
              // en grados se curva al proyectar a Mercator, y en rutas largas
              // (sobre todo cruzando el antimeridiano, ±180°) el avión terminaba
              // lejos de su propia línea. Mismo arreglo que ya usa MapaMundi.
              let lat = a.lat + (b.lat - a.lat) * v.progreso
              let lng = a.lng + (b.lng - a.lng) * v.progreso
              let angle = getHeadingAngle(a, b)
              if (mapInstance) {
                const pa = mapInstance.latLngToLayerPoint([a.lat, a.lng])
                const pb = mapInstance.latLngToLayerPoint([b.lat, b.lng])
                const p = mapInstance.layerPointToLatLng([
                  pa.x + (pb.x - pa.x) * v.progreso,
                  pa.y + (pb.y - pa.y) * v.progreso,
                ])
                lat = p.lat
                lng = p.lng
                angle = Math.atan2(pb.y - pa.y, pb.x - pa.x) * (180 / Math.PI)
              }
              const esResaltadoUt = vueloResaltado && v.vueloId.split('@')[0] === vueloResaltado
              const destacado = v.seleccionado || esResaltadoUt
              // El avión del envío elegido (o del vuelo resaltado) se pinta en
              // amarillo para ubicarlo, igual que MapaMundi hace con la UT
              // resaltada desde su panel.
              const tono = getPlaneColors(v.ocupacionPct)
              const fill = destacado ? '#facc15' : tono.fill
              const stroke = destacado ? '#fde047' : tono.stroke
              return (
                <Marker
                  key={v.key}
                  position={[lat, lng]}
                  icon={crearIconoAvion({ fill, stroke, angle, count: v.count })}
                  zIndexOffset={destacado ? 2500 : 1500}
                  eventHandlers={{
                    click: () => {
                      if (v.envioIds[0]) seleccionarEnvioMapa(v.envioIds[0])
                      else resaltarVueloMapa(v.vueloId.split('@')[0])
                    },
                  }}
                >
                  <Tooltip direction="top" offset={[0, -12]} className="tasf-tooltip" opacity={1}>
                    <div className="text-xs">
                      <div className="font-bold text-white mb-1">{v.origenIcao} → {v.destinoIcao}</div>
                      <div className="font-mono text-[10px] text-slate-400 mb-1">{v.vueloId.split('@')[0]}</div>
                      {v.vacio ? (
                        <div className="text-slate-400">Vuelo vacío (sin carga asignada)</div>
                      ) : (
                        <>
                          <div className="text-slate-300">Envíos: <span className="text-blue-300 font-semibold">{v.count}</span></div>
                          <div className="text-slate-300">
                            Maletas: <span className="text-blue-300 font-semibold">{v.maletas}</span>
                            {v.capacidad > 0 && <span className="text-slate-500">/{v.capacidad}</span>}
                          </div>
                        </>
                      )}
                      <div className="text-slate-300">Progreso: <span className="text-slate-200 font-semibold">{Math.round(v.progreso * 100)}%</span></div>
                      <div className="text-slate-300">
                        Llega: <span className="text-slate-200 font-semibold">{horaConUtc(v.llegadaLocal, v.gmtDestino, v.llegadaUtc)}</span>
                      </div>
                      {v.count > 1 && (
                        <div className="text-slate-500 font-mono mt-1">{v.envioIds.join(', ')}</div>
                      )}
                      {v.seleccionado && (
                        <div className="text-amber-300 mt-1">Envío elegido a bordo</div>
                      )}
                      {esResaltadoUt && !v.seleccionado && (
                        <div className="text-amber-300 mt-1">Vuelo resaltado desde el panel</div>
                      )}
                    </div>
                  </Tooltip>
                </Marker>
              )
            })}

            {/* Dónde está la maleta elegida cuando NO está volando (almacén o
                escala). Volando ya aparece arriba, como avión. */}
            {posicionMaleta && (
              <Marker
                position={[posicionMaleta.lat, posicionMaleta.lng]}
                icon={iconoMaleta(estadoActual.color)}
                zIndexOffset={2000}
              >
                <Tooltip direction="top" offset={[0, -10]} className="tasf-tooltip" opacity={1}>
                  <div className="text-xs">
                    <div className="font-bold text-white">{estadoActual.etiqueta}</div>
                    {estadoActual.detalle && (
                      <div className="text-slate-300">{estadoActual.detalle}</div>
                    )}
                  </div>
                </Tooltip>
              </Marker>
            )}

            {/* Aeropuertos de la ruta (o del vuelo resaltado, si no hay envío
                elegido), resaltados según su papel. */}
            {puntosDestacados.map((p, i) => {
              const c = coords[p.icao]
              if (!c) return null
              return (
                <Marker
                  key={`${p.icao}-${i}`}
                  position={[c.lat, c.lng]}
                  icon={crearIconoAeropuerto(p.color, p.icao)}
                  zIndexOffset={1000}
                >
                  <Tooltip direction="top" offset={[0, -8]} className="tasf-tooltip" opacity={1}>
                    <div className="text-xs">
                      <div className="font-bold text-white">{p.icao} · {c.ciudad}</div>
                      <div className="text-slate-400 capitalize">{p.papel}</div>
                    </div>
                  </Tooltip>
                </Marker>
              )
            })}
          </MapContainer>

          {/* Panel de reloj/resumen, esquina superior izquierda — mismo lugar y
              estilo que el panel "Tiempo de simulación / Tiempo real" de
              MapaMundi, adaptado a que aquí no hay simulación: solo hora UTC
              real y cuántos vuelos/envíos están en curso ahora mismo. Es lo
              que faltaba para "guiarse" igual que en el mapa en vivo. */}
          <div className="absolute top-3 left-3 z-[1000] pointer-events-none">
            <div className="bg-slate-950/95 backdrop-blur border border-blue-500/25 rounded-lg overflow-hidden shadow-lg shadow-black/50 w-64">
              <div className="px-3 py-2 border-b border-slate-700/50">
                <div className="text-[10px] text-blue-300 uppercase tracking-widest font-semibold mb-1.5">
                  Operación en vivo
                </div>
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="text-slate-400">Fecha UTC actual</span>
                  <span className="font-mono text-sm font-bold text-white">{fechaCorta(ahoraUtc)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="text-slate-400">Hora UTC actual</span>
                  <span className="font-mono text-sm font-bold text-white">{hhmmss(ahoraUtc)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-[11px] mt-1 pt-1 border-t border-slate-800/70">
                  <span className="text-slate-400">Hora de este equipo</span>
                  <span className="font-mono text-sm font-bold text-emerald-300">{fechaCorta(ahoraSistema)} {hhmmss(ahoraSistema)}</span>
                </div>
              </div>
              <div className="px-3 py-2 space-y-1 text-[11px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">Vuelos en curso ahora</span>
                  <span className="font-mono text-sm font-bold text-emerald-400">{avionesEnAire.length}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">— con carga / vacíos</span>
                  <span className="font-mono text-sm font-bold text-slate-300">
                    {vuelosActivos.length} / {vuelosVaciosEnAire.length}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">Envíos volando</span>
                  <span className="font-mono text-sm font-bold text-blue-400">{enviosVolando}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">Envíos totales</span>
                  <span className="font-mono text-sm font-bold text-slate-300">{envios.length}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Filtros — mismo panel que MapaMundi: semáforo de almacenes,
              semáforo de aviones y continente. Debajo del panel de
              reloj/resumen, igual que allá va debajo del cartel de época. */}
          <div className="absolute top-60 left-3 z-[1000] bg-slate-900/92 backdrop-blur border border-slate-700 rounded-xl shadow-lg w-44 max-h-[60vh] overflow-y-auto">
            <button
              onClick={() => setFiltroSemaforoAbierto(a => !a)}
              className="w-full px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors text-left sticky top-0 bg-slate-900/95"
            >
              {filtroSemaforoAbierto ? 'Filtros ▴' : 'Filtros ▾'}
            </button>
            {filtroSemaforoAbierto && (
              <div className="px-3 pb-3 space-y-3">
                <FiltroSemaforo titulo="Almacenes" ocultos={almacenesOcultos}
                  onToggle={c => setAlmacenesOcultos(prev => toggleSet(prev, c))} />
                <div className="h-px bg-slate-700" />
                <FiltroSemaforo titulo="Aviones" ocultos={utsOcultas}
                  onToggle={c => setUtsOcultas(prev => toggleSet(prev, c))} />
                {continentes.length > 1 && (
                  <>
                    <div className="h-px bg-slate-700" />
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1.5">Continente</p>
                      <div className="flex flex-col gap-0.5">
                        {continentes.map(c => (
                          <FiltroCheck key={c} marcado={!continentesOcultos.has(c)}
                            onToggle={() => setContinentesOcultos(prev => toggleSet(prev, c))} label={c} />
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Ficha del envío elegido: el plan de viaje completo, tramo a tramo,
              con las horas en la hora de cada aeropuerto. */}
          {envio && (
            <div className="absolute top-3 right-3 z-[1000] w-96 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl shadow-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-white">
                    {envio.origenIcao} → {envio.destinoIcao}
                  </span>
                  <button
                    onClick={() => setSeleccionado(null)}
                    className="text-slate-500 hover:text-slate-300 text-xs"
                  >
                    ✕
                  </button>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  <span className="font-mono">{envio.envioId}</span> · {envio.cantidadMaletas} maletas
                  {envio.idCliente && ` · ${envio.idCliente}`}
                </div>
              </div>

              {/* Estado ahora mismo, lo primero de la ficha: es lo que se
                  pregunta al mirar un envío en curso. */}
              {estadoActual && (
                <div className="px-4 py-2.5 border-b border-slate-700 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: estadoActual.color }} />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold" style={{ color: estadoActual.color }}>
                      {estadoActual.etiqueta}
                    </div>
                    {estadoActual.detalle && (
                      <div className="text-[11px] text-slate-400">{estadoActual.detalle}</div>
                    )}
                  </div>
                </div>
              )}

              <div className="px-4 py-2.5 space-y-1 text-[11px] border-b border-slate-700">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Recibido</span>
                  <span className="font-mono text-slate-200">
                    {fechaHora(envio.registradoLocal)} {envio.gmtOrigen}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Entrega</span>
                  <span className="font-mono text-green-300">
                    {fechaHora(envio.entregaLocalDestino)} {envio.gmtDestino}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Plazo</span>
                  <span className="font-mono text-slate-300">
                    {fechaHora(envio.deadlineLocalDestino)} {envio.gmtDestino}
                  </span>
                </div>
              </div>

              <div className="px-4 py-3 max-h-80 overflow-y-auto">
                <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-3">
                  Plan de viaje · {envio.directa ? 'vuelo directo' : `${envio.escalas} escala(s)`}
                </div>
                <ol className="space-y-3">
                  {envio.tramos?.map((t, i) => (
                    <li key={`${t.vueloId}-${i}`} className="relative pl-4">
                      <span className={`absolute left-0 top-2 w-2 h-2 rounded-full ${
                        t.cancelado ? 'bg-red-500' : 'bg-blue-500'}`} />
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm text-slate-100 font-semibold">
                            {t.origenIcao} → {t.destinoIcao}
                            {t.cancelado && <span className="ml-1.5 text-red-400 text-xs">(cancelado)</span>}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 truncate">{t.vueloId}</div>
                          <div className="text-xs text-slate-300">
                            {horaConUtc(t.salidaLocal, t.gmtOrigen, t.salidaUtc)} → {horaConUtc(t.llegadaLocal, t.gmtDestino, t.llegadaUtc)}
                          </div>
                        </div>
                        {/* Cancelar sin salir del mapa: es la secuencia que pide
                            la prueba, y saltar de pestaña perdería el envío
                            seleccionado. */}
                        {!t.cancelado && (
                          <button
                            onClick={() => cancelarTramo(t.vueloId)}
                            disabled={cancelando === String(t.vueloId).split('@')[0]}
                            title="Cancelar esta salida y reasignar las maletas"
                            className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 hover:text-red-200 disabled:opacity-40 transition-colors"
                          >
                            {cancelando === String(t.vueloId).split('@')[0]
                              ? 'Cancelando…'
                              : '✕ Cancelar vuelo'}
                          </button>
                        )}
                      </div>
                      {t.esperaMinutos > 0 && (
                        <div className="text-xs text-amber-400/90 mt-0.5">
                          Espera {t.esperaMinutos} min en {t.origenIcao}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>

                {avisoCancelacion && (
                  <div className={`mt-3 rounded-lg px-3 py-2 text-xs border ${
                    avisoCancelacion.ok
                      ? 'bg-green-500/10 border-green-500/30 text-green-300'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}>
                    {avisoCancelacion.texto}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Leyenda */}
          <div className="absolute bottom-4 left-4 z-[1000] flex gap-3 bg-slate-900/85 backdrop-blur rounded-lg px-4 py-2 border border-slate-700 shadow-lg flex-wrap max-w-[calc(100%-2rem)]">
            <Leyenda color={COLOR_ORIGEN} label="Origen" />
            <Leyenda color={COLOR_ESCALA} label="Escala" />
            <Leyenda color={COLOR_DESTINO} label="Destino" />
            <Leyenda color="#ef4444" label="Vuelo cancelado" />
            <span className="w-px bg-slate-700" />
            <Leyenda color="#94a3b8" label="Avión vacío" avion />
            <Leyenda color="#4ade80" label="Avión < 60% ocupado" avion />
            <Leyenda color="#fbbf24" label="Avión ≥ 60% ocupado" avion />
            <Leyenda color="#f87171" label="Avión > 85% ocupado" avion />
            <Leyenda color="#facc15" label="Avión del envío elegido" avion />
          </div>

          {!envio && !cargando && envios.length > 0 && avionesEnAire.length === 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/90 border border-slate-700 rounded-full px-4 py-1.5 text-xs text-slate-300 shadow-lg">
              Selecciona un envío de la lista para ver su ruta
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

// Casilla de filtro reutilizable (marcada = visible, desmarcada = oculto del
// mapa) — mismo componente que usa MapaMundi para su panel de filtros.
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

/** Filtro por semáforo (4 colores), reutilizado para "Almacenes" y "Aviones". */
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

function Leyenda({ color, label, avion = false }) {
  return (
    <div className="flex items-center gap-1.5">
      {avion ? (
        <svg viewBox="-8 -8 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M 7,0 L 2,-1.6 L 0,-5 L -2,-2.6 L -3.6,-3.5 L -4.6,-2 L -5,-1 L -5,1 L -4.6,2 L -3.6,3.5 L -2,2.6 L 0,5 L 2,1.6 Z"
            fill={color} stroke="#fff" strokeWidth="1"
          />
        </svg>
      ) : (
        <span className="w-3 h-3 rounded-full" style={{ background: color }} />
      )}
      <span className="text-slate-300 text-xs">{label}</span>
    </div>
  )
}