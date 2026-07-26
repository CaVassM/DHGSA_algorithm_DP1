import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Polyline, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import NavBar from '../components/NavBar'
import { getAirports, getEnviosDiariosConRuta, cancelarVueloDiario } from '../services/api'

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

// Cacheados: sin esto, el mapa se re-renderiza cada segundo (reloj en vivo) y
// cada render creaba un ícono nuevo, forzando a Leaflet a reemplazar el DOM
// del marcador — lo que deja los tooltips de hover pegados abiertos.
const avionIconCache = new Map()
/** Avión en pleno vuelo (mismo dibujo que usa MapaMundi para sus UT). */
function crearIconoAvion(color, angle, count) {
  const key = `${color}|${angle.toFixed(0)}|${count}`
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
            fill="${color}" stroke="#ffffff" stroke-width="1"
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

function fechaHora(iso) {
  return iso ? String(iso).slice(5, 16).replace('T', ' ') : '—'
}

function hhmmss(d) {
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
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
  const [filtro, setFiltro] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

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
  useEffect(() => {
    const id = setInterval(() => setAhoraUtc(ahoraComoUtc()), 1000)
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
      setAvisoCancelacion({ ok: r.aplicada, texto: r.mensaje })
      await refrescar()
    } catch {
      setAvisoCancelacion({ ok: false, texto: 'No se pudo cancelar el vuelo.' })
    } finally {
      setCancelando(null)
    }
  }, [refrescar])

  useEffect(() => {
    let vivo = true
    getAirports(0, 500)
      .then(p => { if (vivo) setAeropuertos(p?.content ?? []) })
      .catch(() => {})
    refrescar()
    // La operación es continua y hay varias terminales registrando a la vez:
    // sin refresco periódico, este visualizador se quedaría con la foto del
    // momento en que se abrió.
    const id = setInterval(refrescar, 5000)
    return () => { vivo = false; clearInterval(id) }
  }, [refrescar])

  const coords = useMemo(() => {
    const m = {}
    aeropuertos.forEach(a => { m[a.codigoIcao] = { lat: a.latitud, lng: a.longitud, ciudad: a.ciudad } })
    return m
  }, [aeropuertos])

  // Estado (fase/color/detalle) de CADA envío, no solo del elegido: alimenta la
  // lista de la izquierda y el agrupado de vuelos activos de más abajo. Un solo
  // cálculo por envío y por tick de reloj, en vez de repetirlo en cada sitio
  // que lo necesita.
  const estadosPorEnvio = useMemo(() => {
    const m = new Map()
    envios.forEach(e => m.set(e.envioId, estadoDeLaMaleta(e, ahoraUtc)))
    return m
  }, [envios, ahoraUtc])

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
          gmtDestino: t.gmtDestino,
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
    return Array.from(grupos.values())
  }, [envios, estadosPorEnvio, seleccionado])

  const enviosFiltrados = useMemo(() => {
    const q = filtro.trim().toUpperCase()
    if (!q) return envios
    return envios.filter(e =>
      e.envioId?.toUpperCase().includes(q)
      || e.destinoIcao?.toUpperCase().includes(q)
      || e.origenIcao?.toUpperCase().includes(q)
      || e.idCliente?.toUpperCase().includes(q))
  }, [envios, filtro])

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

  const icaosEnRuta = new Set(puntosRuta.map(p => p.icao))

  const enviosVolando = vuelosActivos.reduce((acc, v) => acc + v.count, 0)

  return (
    <div className="h-screen flex flex-col bg-[#0f172a] overflow-hidden">
      <NavBar />
      <div className="flex flex-1 overflow-hidden">

        {/* Lista de envíos: es el punto de entrada de la prueba — "se selecciona
            un envío y se debe mostrar en el mapa todas las rutas del envío". */}
        <aside className="w-96 shrink-0 bg-slate-900 border-r border-slate-700 flex flex-col">
          <div className="px-4 py-3.5 border-b border-slate-700">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
              Envíos registrados
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Selecciona uno para ver su ruta en el mapa. Los vuelos en curso de
              TODOS los envíos se ven sin necesidad de elegir ninguno.
            </p>
            <input
              type="text" value={filtro} onChange={e => setFiltro(e.target.value)}
              placeholder="Buscar por id, destino o aerolínea…"
              className="mt-2.5 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {cargando ? (
              <p className="p-4 text-sm text-slate-500">Cargando…</p>
            ) : error ? (
              <p className="p-4 text-sm text-red-400">{error}</p>
            ) : enviosFiltrados.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">
                {envios.length === 0
                  ? 'Todavía no hay envíos registrados. Regístralos en la pantalla de operación.'
                  : 'Ningún envío coincide con la búsqueda.'}
              </p>
            ) : (
              <ul>
                {enviosFiltrados.map(e => {
                  const activo = e.envioId === seleccionado
                  const est = estadosPorEnvio.get(e.envioId)
                  return (
                    <li key={e.envioId}>
                      <button
                        onClick={() => setSeleccionado(activo ? null : e.envioId)}
                        className={`w-full text-left px-4 py-3 border-b border-slate-800 transition-colors ${
                          activo ? 'bg-blue-600/20 border-l-2 border-l-blue-500' : 'hover:bg-slate-800/60'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-base font-medium ${activo ? 'text-blue-300' : 'text-slate-100'}`}>
                            {e.origenIcao} → {e.destinoIcao}
                          </span>
                          <span className="text-xs font-mono text-slate-500">{e.envioId}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <span className="text-xs text-slate-400">
                            {e.cantidadMaletas} maletas
                            {e.idCliente && <span className="text-slate-500"> · {e.idCliente}</span>}
                          </span>
                          <span className="text-xs text-slate-500">
                            {e.directa ? 'directa' : `${e.escalas} escala(s)`}
                          </span>
                        </div>
                        {/* Dónde está la maleta ahora mismo: es lo que se le
                            pregunta a un mapa de operaciones. */}
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: est?.color }} />
                          <span className="text-xs font-medium" style={{ color: est?.color }}>
                            {est?.etiqueta}
                          </span>
                          {est?.detalle && (
                            <span className="text-xs text-slate-500 truncate">· {est.detalle}</span>
                          )}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="px-4 py-2 border-t border-slate-700 text-[11px] text-slate-500">
            {envios.length} envío{envios.length === 1 ? '' : 's'} en la jornada · {enviosVolando} en vuelo ahora
          </div>
        </aside>

        {/* Mapa */}
        <main className="flex-1 relative">
          {/* zoomSnap/zoomDelta a 0.25: por defecto Leaflet salta un nivel
              entero por muesca de rueda, lo que en un mapa mundial pasa de ver
              tres continentes a ver una ciudad. */}
          <MapContainer
            center={CENTRO} zoom={ZOOM} className="w-full h-full" worldCopyJump
            zoomSnap={0.25} zoomDelta={0.25} wheelPxPerZoomLevel={200}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution="&copy; OpenStreetMap &copy; CARTO"
            />

            {/* Aeropuertos que no participan en la ruta elegida: se dejan como
                referencia geográfica, con el mismo ícono que usa el mapa en
                vivo (círculo + silueta de avión), solo que en gris neutro. */}
            {aeropuertos.map(a => (
              icaosEnRuta.has(a.codigoIcao) ? null : (
                <Marker
                  key={a.codigoIcao}
                  position={[a.latitud, a.longitud]}
                  icon={crearIconoAeropuerto(COLOR_NEUTRO)}
                >
                  <Tooltip direction="top" className="tasf-tooltip" opacity={1}>
                    <span className="text-xs">{a.codigoIcao} · {a.ciudad}</span>
                  </Tooltip>
                </Marker>
              )
            ))}

            {/* Tramos del envío seleccionado, en orden de vuelo. */}
            {envio?.tramos?.map((t, i) => {
              const a = coords[t.origenIcao]
              const b = coords[t.destinoIcao]
              if (!a || !b) return null
              // El tramo que la maleta está volando ahora se destaca; los que ya
              // quedaron atrás se atenúan. Así se lee de un vistazo por dónde va
              // el viaje sin necesidad de animar nada.
              const enCurso = estadoActual?.fase === 'en-vuelo' && estadoActual.tramoActual === i
              const yaPasado = estadoActual?.tramoActual != null && i < estadoActual.tramoActual
              return (
                <Polyline
                  key={`${t.vueloId}-${i}`}
                  positions={[[a.lat, a.lng], [b.lat, b.lng]]}
                  pathOptions={{
                    color: t.cancelado ? '#ef4444' : enCurso ? '#60a5fa' : '#3b82f6',
                    weight: enCurso ? 5 : 3,
                    opacity: t.cancelado ? 0.9 : yaPasado ? 0.35 : 0.9,
                    // El tramo cancelado se dibuja discontinuo: sigue siendo
                    // parte del historial del envío, pero ese avión no vuela.
                    dashArray: t.cancelado ? '6 6' : null,
                  }}
                >
                  <Tooltip sticky className="tasf-tooltip" opacity={1}>
                    <div className="text-xs">
                      <div className="font-bold text-white mb-1">
                        Tramo {i + 1} · {t.origenIcao} → {t.destinoIcao}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400 mb-1">{t.vueloId}</div>
                      <div className="text-slate-300">
                        Sale {hhmm(t.salidaLocal)} {t.gmtOrigen}
                      </div>
                      <div className="text-slate-300">
                        Llega {hhmm(t.llegadaLocal)} {t.gmtDestino}
                      </div>
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

            {/* TODOS los vuelos en curso ahora mismo, de cualquier envío — el
                pedido central: que el mapa de operaciones se vea como el mapa
                en vivo, con la flota completa a la vista y no un envío a la
                vez. El avión del envío seleccionado (si está volando) se
                destaca con un tono más claro y por encima del resto. */}
            {vuelosActivos.map(v => {
              const a = coords[v.origenIcao]
              const b = coords[v.destinoIcao]
              if (!a || !b) return null
              const lat = a.lat + (b.lat - a.lat) * v.progreso
              const lng = a.lng + (b.lng - a.lng) * v.progreso
              const angle = getHeadingAngle(a, b)
              const color = v.seleccionado ? '#93c5fd' : '#3b82f6'
              return (
                <Marker
                  key={v.key}
                  position={[lat, lng]}
                  icon={crearIconoAvion(color, angle, v.count)}
                  zIndexOffset={v.seleccionado ? 2500 : 1500}
                  eventHandlers={{ click: () => setSeleccionado(v.envioIds[0]) }}
                >
                  <Tooltip direction="top" offset={[0, -12]} className="tasf-tooltip" opacity={1}>
                    <div className="text-xs">
                      <div className="font-bold text-white font-mono">{v.vueloId.split('@')[0]}</div>
                      <div className="text-slate-300">{v.origenIcao} → {v.destinoIcao}</div>
                      <div className="text-slate-400">
                        {Math.round(v.progreso * 100)}% · llega {hhmm(v.llegadaLocal)} {v.gmtDestino}
                      </div>
                      <div className="text-slate-500">
                        {v.count} envío{v.count === 1 ? '' : 's'} · {v.maletas} maletas
                      </div>
                      {v.count > 1 && (
                        <div className="text-slate-500 font-mono">{v.envioIds.join(', ')}</div>
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

            {/* Aeropuertos de la ruta, resaltados según su papel. */}
            {puntosRuta.map((p, i) => {
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
                  <span className="text-slate-400">Hora UTC actual</span>
                  <span className="font-mono text-sm font-bold text-white">{hhmmss(ahoraUtc)}</span>
                </div>
              </div>
              <div className="px-3 py-2 space-y-1 text-[11px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">Vuelos en curso ahora</span>
                  <span className="font-mono text-sm font-bold text-emerald-400">{vuelosActivos.length}</span>
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
                            {hhmm(t.salidaLocal)} {t.gmtOrigen} → {hhmm(t.llegadaLocal)} {t.gmtDestino}
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
            <Leyenda color="#3b82f6" label="Avión en vuelo" avion />
            <Leyenda color="#93c5fd" label="Avión del envío elegido" avion />
          </div>

          {!envio && !cargando && envios.length > 0 && vuelosActivos.length === 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/90 border border-slate-700 rounded-full px-4 py-1.5 text-xs text-slate-300 shadow-lg">
              Selecciona un envío de la lista para ver su ruta
            </div>
          )}
        </main>
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