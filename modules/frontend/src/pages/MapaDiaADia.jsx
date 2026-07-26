import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import NavBar from '../components/NavBar'
import { getAirports, getEnviosDiariosConRuta, getEstadoDiario, cancelarVueloDiario } from '../services/api'
import { getSemaforoPorOcupacion, SEMAFORO_COLORES } from '../data/aeropuertos'

// Mapa de operaciones día a día.
//
// Pantalla SEPARADA de la de registro, como pide el enunciado: aquella es para
// el empleado que solo recepciona maletas, esta es para ver la operación. Aquí
// se elige un envío y se dibujan todas sus rutas de manera gráfica.
//
// No comparte código con MapaMundi (el de la simulación 5D) a propósito: aquel
// vive de eventos por época, reloj simulado y reproductor, nada de lo cual
// existe en la operación real. Lo que sí se porta 1:1 es el "panel de control"
// (filtros por semáforo de almacenes/UT + continente, y las listas operativas
// de almacenes/UT/envíos) porque es la misma idea de producto — solo cambia de
// dónde sale el dato: aquí es el estado en vivo de la operación real
// (`/daily/state`, `/daily/shipments`), no una corrida de simulación.

const CENTRO = [10, -20]
const ZOOM = 2

/** Aeropuerto normal: círculo pequeño, discreto. */
const iconoAeropuerto = L.divIcon({
  className: 'tasf-daily-airport',
  html: '<div style="width:8px;height:8px;border-radius:50%;background:#475569;border:1px solid #94a3b8;"></div>',
  iconSize: [8, 8],
  iconAnchor: [4, 4],
})

/** Aeropuerto atenuado: filtrado por semáforo de almacén o por continente. */
const iconoAeropuertoAtenuado = L.divIcon({
  className: 'tasf-daily-airport',
  html: '<div style="width:8px;height:8px;border-radius:50%;background:#475569;border:1px solid #94a3b8;opacity:0.25;"></div>',
  iconSize: [8, 8],
  iconAnchor: [4, 4],
})

/** Aeropuerto que participa en la ruta seleccionada. */
function iconoRuta(color, etiqueta) {
  return L.divIcon({
    className: 'tasf-daily-airport',
    html: `<div style="display:flex;flex-direction:column;align-items:center;">
      <div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(2,6,23,.8);"></div>
      <div style="margin-top:2px;font:600 10px/1 ui-monospace,monospace;color:#e2e8f0;text-shadow:0 1px 3px #020617;white-space:nowrap;">${etiqueta}</div>
    </div>`,
    iconSize: [14, 26],
    iconAnchor: [7, 7],
  })
}

/** Posición actual de la maleta en tierra: anillo pulsante del color de su estado. */
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

// Ángulo de rumbo entre dos puntos (para orientar el ícono del avión). Misma
// fórmula que MapaMundi.getHeadingAngle: no se importa de allá a propósito
// (este mapa no comparte código con el de la simulación), pero el resultado
// visual debe ser idéntico.
function getHeadingAngle(from, to) {
  const dx = to.lng - from.lng
  const dy = to.lat - from.lat
  return Math.atan2(-dy, dx) * (180 / Math.PI)
}

/**
 * Ícono de avión en vuelo, mismo SVG y clases CSS que MapaMundi
 * (`.tasf-plane-icon-wrapper` / `.tasf-plane-icon`, definidas en index.css)
 * para que la maleta en tránsito se vea igual en los dos mapas. Sin badge de
 * conteo: aquí siempre es UN envío, no un vuelo compartido por varios.
 */
function iconoAvion({ fill, stroke, angle }) {
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
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

// T54/T55 (idéntico a MapaMundi): filtro por semáforo de carga. Un color
// "apagado" (en `ocultos`) atenúa en el mapa las entidades de ese color.
const SEMAFORO_FILTRO = [
  { color: 'vacio', hex: '#94a3b8', label: 'Vacío' },
  { color: 'verde', hex: '#4ade80', label: 'Baja carga' },
  { color: 'ambar', hex: '#fbbf24', label: 'Carga media' },
  { color: 'rojo', hex: '#f87171', label: 'Carga alta' },
]

// Alterna un valor en un Set (sin mutar el original). Igual que en MapaMundi.
function toggleSet(set, valor) {
  const next = new Set(set)
  if (next.has(valor)) next.delete(valor); else next.add(valor)
  return next
}

function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function hhmm(iso) {
  return iso ? String(iso).slice(11, 16) : '—'
}

function fechaHora(iso) {
  return iso ? String(iso).slice(5, 16).replace('T', ' ') : '—'
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

/** Dónde está físicamente parada la maleta ahora mismo (para almacenes), o null si está volando/entregada. */
function ubicacionEnTierra(envio, estado) {
  if (estado.fase === 'en-almacen') return envio.tramos?.[0]?.origenIcao ?? null
  if (estado.fase === 'en-escala') return envio.tramos?.[estado.tramoActual]?.destinoIcao ?? null
  return null
}

// Recentra el mapa sobre un punto (clic en un almacén desde el panel). Es un
// simple flyTo, no el ajuste de viewport completo de MapaMundi (aquí no hace
// falta encajar TODOS los aeropuertos, solo llevar la vista a uno).
function MapFlyTo({ target }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 4), { duration: 0.6 })
  }, [target, map])
  return null
}

const TABS_PANEL = [
  { id: 'almacenes', label: 'Almacenes' },
  { id: 'ut', label: 'UT' },
  { id: 'envios', label: 'Envíos' },
]

export default function MapaDiaADia() {
  const [aeropuertos, setAeropuertos] = useState([])
  const [envios, setEnvios] = useState([])
  const [estadoDiario, setEstadoDiario] = useState(null)
  // ?envio=DIA-3 llega desde la pantalla de registro ("ver en el mapa"): abre
  // el mapa con ese envío ya elegido, sin tener que buscarlo en la lista.
  const [searchParams] = useSearchParams()
  const [seleccionado, setSeleccionado] = useState(() => searchParams.get('envio'))
  const [filtro, setFiltro] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  // Panel de control: mismas tres listas operativas que el mapa en vivo
  // (Almacenes / UT / Envíos), solo que alimentadas desde el estado real de
  // la operación día a día en vez de una corrida de simulación.
  const [panelTab, setPanelTab] = useState('envios')
  const [almacenSeleccionado, setAlmacenSeleccionado] = useState(null)
  const [flyTarget, setFlyTarget] = useState(null)

  // T54/T55 (idénticos a MapaMundi): filtro por semáforo de almacenes, por
  // semáforo de UT (aviones) y por continente. Sets de valores OCULTOS; vacío
  // = todo visible.
  const [almacenesOcultos, setAlmacenesOcultos] = useState(() => new Set())
  const [utsOcultas, setUtsOcultas] = useState(() => new Set())
  const [continentesOcultos, setContinentesOcultos] = useState(() => new Set())
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false)

  // Cancelación desde el propio mapa. La prueba encadena "seleccionar un envío,
  // verlo en el mapa, cancelar un vuelo y comprobar la reasignación": mandar a
  // otra pantalla justo en ese punto obligaría a saltar de pestaña y volver,
  // con el mapa perdiendo el envío elegido por el camino. También se puede
  // cancelar directo desde la pestaña "UT" del panel.
  const [cancelando, setCancelando] = useState(null)
  const [avisoCancelacion, setAvisoCancelacion] = useState(null)

  // Reloj en UTC: es contra el que se sitúan los tramos, que vienen fechados en
  // esa misma línea de tiempo. Avanza cada 30 s — la operación real no cambia
  // más rápido que eso y refrescar por segundo solo gastaría renders.
  const [ahoraUtc, setAhoraUtc] = useState(ahoraComoUtc)
  useEffect(() => {
    const id = setInterval(() => setAhoraUtc(ahoraComoUtc()), 30000)
    return () => clearInterval(id)
  }, [])

  const refrescar = useCallback(async () => {
    try {
      const [lista, estado] = await Promise.all([
        getEnviosDiariosConRuta(),
        getEstadoDiario().catch(() => null),
      ])
      setEnvios(lista ?? [])
      if (estado) setEstadoDiario(estado)
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
      setAvisoCancelacion({ ok: r.aplicada, texto: r.mensaje, vuelo: plantilla })
      await refrescar()
    } catch {
      setAvisoCancelacion({ ok: false, texto: 'No se pudo cancelar el vuelo.', vuelo: plantilla })
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

  const enviosFiltrados = useMemo(() => {
    const q = filtro.trim().toUpperCase()
    if (!q) return envios
    return envios.filter(e =>
      e.envioId?.toUpperCase().includes(q)
      || e.destinoIcao?.toUpperCase().includes(q)
      || e.origenIcao?.toUpperCase().includes(q)
      || e.idCliente?.toUpperCase().includes(q))
  }, [envios, filtro])

  // Continentes presentes en el dataset, para el filtro (igual que MapaMundi).
  const continentes = useMemo(
    () => Array.from(new Set(aeropuertos.map(a => a.continente).filter(Boolean))).sort(),
    [aeropuertos],
  )

  const icaosContinenteOculto = useMemo(() => {
    const set = new Set()
    if (continentesOcultos.size === 0) return set
    aeropuertos.forEach(a => { if (continentesOcultos.has(a.continente)) set.add(a.codigoIcao) })
    return set
  }, [aeropuertos, continentesOcultos])

  // Ocupación de almacén de cada aeropuerto AHORA MISMO: maletas de envíos que
  // están físicamente ahí (en su almacén de origen, o esperando conexión en una
  // escala). Es el equivalente día-a-día de MapaMundi.almacenOcupacion — ahí se
  // deriva de las rutas de una corrida; aquí, del estado real de los envíos.
  const ocupacionAlmacenes = useMemo(() => {
    const acc = {}
    envios.forEach(e => {
      const est = estadoDeLaMaleta(e, ahoraUtc)
      const icao = ubicacionEnTierra(e, est)
      if (!icao) return
      acc[icao] = (acc[icao] ?? 0) + Number(e.cantidadMaletas ?? 0)
    })
    return acc
  }, [envios, ahoraUtc])

  const almacenesView = useMemo(() => {
    const q = normalizarTexto(filtro)
    const preparados = aeropuertos.map(a => {
      const actual = ocupacionAlmacenes[a.codigoIcao] ?? 0
      const capacidad = Number(a.capacidadAlmacen ?? 0)
      const pct = capacidad > 0 ? Math.round((actual / capacidad) * 1000) / 10 : 0
      return { ...a, _actual: actual, _pct: pct, _sem: getSemaforoPorOcupacion(pct) }
    })
    const filtrados = q
      ? preparados.filter(a => normalizarTexto(`${a.codigoIcao} ${a.ciudad} ${a.pais}`).includes(q))
      : preparados
    return [...filtrados].sort((a, b) => b._pct - a._pct)
  }, [aeropuertos, ocupacionAlmacenes, filtro])

  // ICAOs cuyo semáforo de ocupación de almacén está apagado por el filtro.
  const icaosSemaforoOculto = useMemo(() => {
    const set = new Set()
    if (almacenesOcultos.size === 0) return set
    almacenesView.forEach(a => { if (almacenesOcultos.has(a._sem)) set.add(a.codigoIcao) })
    return set
  }, [almacenesView, almacenesOcultos])

  // Conjunto combinado (continente + semáforo de almacén) para dimming en el
  // mapa: mismo criterio que MapaMundi.icaosOcultos.
  const icaosOcultosEnMapa = useMemo(() => {
    const set = new Set(icaosContinenteOculto)
    icaosSemaforoOculto.forEach(icao => set.add(icao))
    return set
  }, [icaosContinenteOculto, icaosSemaforoOculto])

  const utsView = useMemo(() => {
    const q = normalizarTexto(filtro)
    const vuelos = estadoDiario?.vuelos ?? []
    const preparados = vuelos.map(v => ({
      ...v,
      _sem: getSemaforoPorOcupacion(v.ocupacionPorcentaje ?? 0),
    }))
    const filtrados = q
      ? preparados.filter(v => normalizarTexto(`${v.vueloId} ${v.origenIcao} ${v.destinoIcao}`).includes(q))
      : preparados
    return [...filtrados].sort((a, b) => (b.ocupacionPorcentaje ?? 0) - (a.ocupacionPorcentaje ?? 0))
  }, [estadoDiario, filtro])

  // Envíos parados ahora en un almacén, y envíos en camino hacia él (todavía
  // sin entregar): lo que se despliega al abrir un almacén en la lista.
  const detalleAlmacen = useMemo(() => {
    if (!almacenSeleccionado) return null
    const aqui = []
    const entrando = []
    envios.forEach(e => {
      const est = estadoDeLaMaleta(e, ahoraUtc)
      if (ubicacionEnTierra(e, est) === almacenSeleccionado) aqui.push(e)
      if (e.destinoIcao === almacenSeleccionado && est.fase !== 'entregada') entrando.push(e)
    })
    return { icao: almacenSeleccionado, aqui, entrando }
  }, [almacenSeleccionado, envios, ahoraUtc])

  function seleccionarAlmacen(icao) {
    setAlmacenSeleccionado(prev => (prev === icao ? null : icao))
    const c = coords[icao]
    if (c) setFlyTarget({ lat: c.lat, lng: c.lng, nonce: Date.now() })
  }

  function irAlEnvio(envioId) {
    setPanelTab('envios')
    setFiltro('')
    setSeleccionado(envioId)
  }

  const envio = envios.find(e => e.envioId === seleccionado) ?? null
  const estadoActual = envio ? estadoDeLaMaleta(envio, ahoraUtc) : null

  /**
   * Punto del mapa donde está la maleta ahora. En vuelo se interpola sobre el
   * tramo en curso; en tierra (almacén o escala) es el propio aeropuerto.
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
    if (estadoActual.fase === 'en-vuelo') {
      const t = tramos[estadoActual.tramoActual]
      const a = coords[t?.origenIcao]
      const b = coords[t?.destinoIcao]
      if (!a || !b) return null
      return {
        lat: a.lat + (b.lat - a.lat) * estadoActual.progreso,
        lng: a.lng + (b.lng - a.lng) * estadoActual.progreso,
        // Rumbo del ícono de avión (mismo estilo que MapaMundi).
        angle: getHeadingAngle(a, b),
      }
    }
    return null // entregada: ya no hay nada que situar
  }, [envio, estadoActual, coords])

  // Semáforo de la UT que transporta ahora mismo al envío seleccionado, para
  // que el filtro "UT (aviones)" también atenúe el ícono de avión del mapa.
  const utActualSemaforo = useMemo(() => {
    if (estadoActual?.fase !== 'en-vuelo' || !envio) return null
    const tramoActivo = envio.tramos?.[estadoActual.tramoActual]
    if (!tramoActivo) return null
    const ut = (estadoDiario?.vuelos ?? []).find(v => v.vueloId === tramoActivo.vueloId)
    return ut ? getSemaforoPorOcupacion(ut.ocupacionPorcentaje ?? 0) : null
  }, [estadoActual, envio, estadoDiario])

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

  return (
    <div className="h-screen flex flex-col bg-[#0f172a] overflow-hidden">
      <NavBar />
      <div className="flex flex-1 overflow-hidden">

        {/* Panel de control: Almacenes / UT / Envíos — mismas tres listas
            operativas que el Dashboard del mapa en vivo (PanelListas), leídas
            del estado real de la operación en vez de una corrida. */}
        <aside className="w-96 shrink-0 bg-slate-900 border-r border-slate-700 flex flex-col">
          <div className="flex bg-slate-900 border-b border-slate-700">
            {TABS_PANEL.map(t => (
              <button
                type="button"
                key={t.id}
                onClick={() => { setPanelTab(t.id); setFiltro('') }}
                className={`flex-1 px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                  panelTab === t.id
                    ? 'text-blue-300 border-b-2 border-blue-500 bg-slate-800/50'
                    : 'text-slate-500 hover:text-slate-300'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="px-4 py-3 border-b border-slate-700">
            <p className="text-xs text-slate-500 mb-2">
              {panelTab === 'almacenes' ? 'Ocupación de almacenes en vivo.'
                : panelTab === 'ut' ? 'Capacidad de vuelos en vivo.'
                : 'Selecciona un envío para ver su ruta en el mapa.'}
            </p>
            <input
              type="text" value={filtro} onChange={e => setFiltro(e.target.value)}
              placeholder={
                panelTab === 'almacenes' ? 'Buscar aeropuerto o ciudad…'
                  : panelTab === 'ut' ? 'Buscar vuelo, origen o destino…'
                    : 'Buscar por id, destino o aerolínea…'
              }
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {cargando ? (
              <p className="p-4 text-sm text-slate-500">Cargando…</p>
            ) : error ? (
              <p className="p-4 text-sm text-red-400">{error}</p>
            ) : panelTab === 'almacenes' ? (
              almacenesView.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">Ningún aeropuerto coincide con la búsqueda.</p>
              ) : (
                <ul>
                  {almacenesView.map(a => {
                    const abierto = almacenSeleccionado === a.codigoIcao
                    return (
                      <li key={a.codigoIcao}>
                        <button
                          type="button"
                          onClick={() => seleccionarAlmacen(a.codigoIcao)}
                          className={`w-full text-left px-4 py-3 border-b border-slate-800 transition-colors ${
                            abierto ? 'bg-blue-600/20 border-l-2 border-l-blue-500' : 'hover:bg-slate-800/60'}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-sm text-blue-300">{a.codigoIcao}</span>
                            <SemChip sem={a._sem} pct={a._pct} />
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-1">
                            <span className="text-xs text-slate-400 truncate">{a.ciudad} · {a.pais}</span>
                            <span className="text-[11px] text-slate-500 font-mono shrink-0">
                              {a._actual.toLocaleString()}/{Number(a.capacidadAlmacen ?? 0).toLocaleString()}
                            </span>
                          </div>
                        </button>
                        {abierto && detalleAlmacen && (
                          <div className="bg-slate-900/70 border-b border-slate-800 px-4 py-2.5 space-y-2">
                            <ListaMini
                              titulo={`Aquí ahora (${detalleAlmacen.aqui.length})`}
                              color="text-green-400"
                              envios={detalleAlmacen.aqui}
                              onSelect={irAlEnvio}
                            />
                            <ListaMini
                              titulo={`En camino (${detalleAlmacen.entrando.length})`}
                              color="text-amber-400"
                              envios={detalleAlmacen.entrando}
                              onSelect={irAlEnvio}
                            />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )
            ) : panelTab === 'ut' ? (
              utsView.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">
                  {(estadoDiario?.vuelos?.length ?? 0) === 0
                    ? 'Todavía no hay vuelos con carga en la jornada.'
                    : 'Ningún vuelo coincide con la búsqueda.'}
                </p>
              ) : (
                <ul>
                  {utsView.map(v => (
                    <li key={v.vueloId} className="px-4 py-3 border-b border-slate-800">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-blue-300 truncate">{v.vueloId}</span>
                        <SemChip sem={v._sem} pct={v.ocupacionPorcentaje} />
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="text-xs text-slate-300">{v.origenIcao} → {v.destinoIcao}</span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          {v.ocupado}/{v.capacidad}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => cancelarTramo(v.vueloId)}
                        disabled={cancelando === String(v.vueloId).split('@')[0]}
                        className="mt-2 w-full py-1.5 rounded border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed text-red-300 text-[10px] font-medium transition-colors"
                      >
                        {cancelando === String(v.vueloId).split('@')[0] ? 'Cancelando…' : '✕ Cancelar este vuelo'}
                      </button>
                      {avisoCancelacion && cancelando === null
                        && String(v.vueloId).split('@')[0] === avisoCancelacion.vuelo && (
                        <p className={`mt-1.5 text-[10px] leading-snug ${
                          avisoCancelacion.ok ? 'text-red-300' : 'text-amber-300'}`}>
                          {avisoCancelacion.texto}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )
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
                  const est = estadoDeLaMaleta(e, ahoraUtc)
                  return (
                    <li key={e.envioId}>
                      <button
                        type="button"
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
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: est.color }} />
                          <span className="text-xs font-medium" style={{ color: est.color }}>
                            {est.etiqueta}
                          </span>
                          {est.detalle && (
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
            {panelTab === 'almacenes'
              ? `${almacenesView.length} aeropuerto(s)`
              : panelTab === 'ut'
                ? `${utsView.length} vuelo(s) con carga`
                : `${envios.length} envío${envios.length === 1 ? '' : 's'} en la jornada`}
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

            <MapFlyTo target={flyTarget} />

            {/* Aeropuertos que no participan en la ruta elegida: se dejan como
                referencia geográfica, sin competir por la atención. */}
            {aeropuertos.map(a => (
              icaosEnRuta.has(a.codigoIcao) ? null : (
                <Marker
                  key={a.codigoIcao}
                  position={[a.latitud, a.longitud]}
                  icon={icaosOcultosEnMapa.has(a.codigoIcao) ? iconoAeropuertoAtenuado : iconoAeropuerto}
                  eventHandlers={{ click: () => seleccionarAlmacen(a.codigoIcao) }}
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
              // Filtro por continente / semáforo de almacén: si el aeropuerto de
              // origen o destino de este tramo está apagado, se atenúa (regla
              // del profesor: filtrar aeropuertos oculta sus vuelos).
              const filtroOculto = icaosOcultosEnMapa.has(t.origenIcao)
                || icaosOcultosEnMapa.has(t.destinoIcao)
              return (
                <Polyline
                  key={`${t.vueloId}-${i}`}
                  positions={[[a.lat, a.lng], [b.lat, b.lng]]}
                  pathOptions={{
                    color: t.cancelado ? '#ef4444' : enCurso ? '#60a5fa' : '#3b82f6',
                    weight: enCurso ? 5 : 3,
                    opacity: filtroOculto ? 0.12 : (t.cancelado ? 0.9 : yaPasado ? 0.35 : 0.9),
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

            {/* Dónde está la maleta ahora. Sobre el tramo si va volando, sobre
                el aeropuerto si está en tierra. */}
            {posicionMaleta && (
              <Marker
                position={[posicionMaleta.lat, posicionMaleta.lng]}
                // En vuelo se ve como un avión (mismo ícono/estilo que el mapa
                // en vivo, rotado hacia su rumbo, atenuado si el filtro de UT
                // apaga su semáforo de carga); en tierra sigue siendo el punto
                // pulsante, que ahí sí representa una maleta quieta.
                icon={estadoActual.fase === 'en-vuelo' && posicionMaleta.angle != null
                  ? iconoAvion({ fill: estadoActual.color, stroke: '#bfdbfe', angle: posicionMaleta.angle })
                  : iconoMaleta(estadoActual.color)}
                opacity={utActualSemaforo && utsOcultas.has(utActualSemaforo) ? 0.2 : 1}
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
                  icon={iconoRuta(p.color, p.icao)}
                  zIndexOffset={1000}
                  eventHandlers={{ click: () => seleccionarAlmacen(p.icao) }}
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

          {/* T54/T55 (idéntico a MapaMundi): filtros por semáforo de almacenes,
              por semáforo de UT y por continente, en un panel plegable. */}
          <div className="absolute top-3 left-3 z-[1000] bg-slate-900/92 backdrop-blur border border-slate-700 rounded-xl shadow-lg w-44">
            <button
              onClick={() => setFiltrosAbiertos(a => !a)}
              className="w-full px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors text-left"
            >
              {filtrosAbiertos ? 'Filtros ▴' : 'Filtros ▾'}
            </button>
            {filtrosAbiertos && (
              <div className="px-3 pb-3 max-h-80 overflow-y-auto">
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
          <div className="absolute bottom-4 left-4 z-[1000] flex gap-3 bg-slate-900/80 backdrop-blur rounded-lg px-4 py-2 border border-slate-700 shadow-lg flex-wrap max-w-[calc(100%-2rem)]">
            <Leyenda color={COLOR_ORIGEN} label="Origen" />
            <Leyenda color={COLOR_ESCALA} label="Escala" />
            <Leyenda color={COLOR_DESTINO} label="Destino" />
            <Leyenda color="#ef4444" label="Vuelo cancelado" />
            <span className="w-px bg-slate-700" />
            <Leyenda color="#3b82f6" label="Maleta en vuelo (avión)" />
            <Leyenda color="#22c55e" label="Maleta en tierra (punto pulsante)" />
          </div>

          {!envio && !cargando && envios.length > 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/90 border border-slate-700 rounded-full px-4 py-1.5 text-xs text-slate-300 shadow-lg">
              Selecciona un envío de la lista para ver su ruta
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function Leyenda({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-full" style={{ background: color }} />
      <span className="text-slate-300 text-xs">{label}</span>
    </div>
  )
}

function SemChip({ sem, pct }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SEMAFORO_COLORES[sem] }} />
      <span className="text-[10px] text-slate-400">{Number(pct ?? 0).toFixed(0)}%</span>
    </span>
  )
}

// Lista compacta de envíos (usada en el detalle de un almacén: quién está ahí
// ahora / quién viene en camino). Versión chica de PanelListas.ListaFlujo.
function ListaMini({ titulo, color, envios, onSelect }) {
  return (
    <div>
      <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${color}`}>
        {titulo}
      </div>
      {envios.length === 0 ? (
        <p className="text-[11px] text-slate-500 pb-1">Sin envíos.</p>
      ) : (
        <ul className="space-y-1 max-h-32 overflow-y-auto">
          {envios.slice(0, 30).map(e => (
            <li key={e.envioId}>
              <button
                type="button"
                onClick={() => onSelect(e.envioId)}
                className="w-full text-left rounded px-2 py-1 bg-slate-800/60 hover:bg-slate-700/60 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-blue-300 truncate">{e.envioId}</span>
                  <span className="font-mono text-[11px] text-slate-300 shrink-0">
                    {Number(e.cantidadMaletas ?? 0)} mal.
                  </span>
                </div>
                <div className="text-[10px] text-slate-400">{e.origenIcao} → {e.destinoIcao}</div>
              </button>
            </li>
          ))}
          {envios.length > 30 && (
            <li className="text-[10px] text-slate-500 px-2 pt-1">
              …y {envios.length - 30} envíos más
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

// T54/T55: casilla marcada = visible, desmarcada = oculto/atenuado en el mapa.
// Idéntico al de MapaMundi.
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
// aeropuertos y los tramos hacia/desde ellos (igual que MapaMundi).
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
