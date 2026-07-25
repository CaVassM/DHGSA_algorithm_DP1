import { useState, useEffect, useMemo, useRef } from 'react'
import { getAirports, getFlights, getShipments } from '../services/api'
import { SEMAFORO_COLORES, getSemaforoPorOcupacion } from '../data/aeropuertos'

// Panel de control con las TRES listas que pidió el profesor (almacenes,
// unidades de transporte / vuelos y envíos), dentro del contexto del mapa,
// con búsqueda, ordenamiento y scroll. Presentación por pestañas: una lista
// visible a la vez para ocupar poco espacio vertical.
//
// `ocupacionPorIcao` (opcional) viene del Dashboard/Mapa: maletas actualmente
// en cada almacén en el instante simulado. Permite mostrar el semáforo de carga
// real; si no llega, se asume 0 (almacén vacío).

const TABS = [
  { id: 'almacenes', label: 'Almacenes' },
  { id: 'vuelos',    label: 'Vuelos' },
  { id: 'envios',    label: 'Envíos' },
]

const SEM_LABEL = { vacio: 'Vacío', verde: 'Baja carga', ambar: 'Carga media', rojo: 'Carga alta' }

// Normaliza un ID de envío para comparar sin importar los ceros de relleno:
// "000000028" → "28". Si es puramente numérico quita los ceros a la izquierda.
const normalizarId = (id) => {
  const s = String(id ?? '').trim().toLowerCase()
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s
}

// Comparadores reutilizables (cadena/número, ascendente).
const byStr = key => (a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''))
const byNum = key => (a, b) => (Number(a[key] ?? 0) - Number(b[key] ?? 0))

const ORDEN_ALMACENES = {
  icao:      { label: 'Código',            cmp: byStr('codigoIcao') },
  ciudad:    { label: 'Ciudad',            cmp: byStr('ciudad') },
  capacidad: { label: 'Capacidad',         cmp: byNum('capacidadAlmacen') },
  carga:     { label: 'Ocupación',         cmp: (a, b) => (a._pct - b._pct) },
}

// E12–E16: los cuatro criterios que pide la rúbrica (ocupación, hora de salida,
// hora de llegada, origen y destino). El sentido asc/desc lo controla el botón
// ↑↓ del panel, así que aquí los comparadores se definen siempre ascendentes.
const ORDEN_VUELOS = {
  salida:    { label: 'Hora salida',       cmp: byStr('horaSalida') },
  llegada:   { label: 'Hora llegada',      cmp: byStr('horaLlegada') },
  origen:    { label: 'Origen',            cmp: byStr('origenIcao') },
  destino:   { label: 'Destino',           cmp: byStr('destinoIcao') },
  ocupacion: { label: 'Ocupación',         cmp: (a, b) => (a._pct - b._pct) },
}

const ORDEN_ENVIOS = {
  deadline:  { label: 'Deadline',          cmp: byStr('deadline') },
  maletas:   { label: 'Maletas',           cmp: byNum('cantidadMaletas') },
  prioridad: { label: 'Prioridad',         cmp: byNum('prioridad') },
  id:        { label: 'ID',                cmp: byStr('businessId') },
}



function flightPct(f) {
  const cap = Number(f.capacidad ?? 0)
  if (cap <= 0) return 0
  const usada = cap - Number(f.capacidadDisponible ?? cap)
  return Math.round((usada / cap) * 100 * 10) / 10
}

function fmtFecha(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function PanelListas({runId,enVuelo=[], enviosOperativos = {planificados: [],enVuelo: [],entregados4h: [],},ocupacionPorIcao = {}, airportFromMap, flightFromMap, onSelectAirport, onSelectShipment, onSelectFlight }) {
  
  const [tab, setTab] = useState('almacenes')
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState({ almacenes: 'icao', vuelos: 'salida', envios: 'deadline' })
  // E12–E16: sentido del ordenamiento por pestaña. 'asc' | 'desc'.
  const [dir, setDir] = useState({ almacenes: 'asc', vuelos: 'asc', envios: 'asc' })
  const dirActual = dir[tab]
  // Aplica el sentido al comparador base (todos definidos ascendentes).
  const conDireccion = (cmp) => (dirActual === 'desc' ? (a, b) => cmp(b, a) : cmp)

  const [airports, setAirports] = useState([])
  const [flights, setFlights] = useState([])
  const [shipments, setShipments] = useState([])
  const [cargando, setCargando] = useState(true)

  const [estadoEnvio, setEstadoEnvio] = useState('planificados')
  // E03/E04: vuelo cuyo detalle (envíos y maletas que traslada) está abierto.
  const [vueloAbierto, setVueloAbierto] = useState(null)
  // E18/E21/E23: almacén cuyo detalle de envíos (entran / salen) está abierto.
  const [almacenAbierto, setAlmacenAbierto] = useState(null)
  // E07/E08/E10/E11: campo sobre el que aplica la búsqueda de vuelos.
  // 'todo' | 'origen' | 'destino'.
  const [campoBusquedaVuelos, setCampoBusquedaVuelos] = useState('todo')
  // Envío cuya ruta se está mostrando en el mapa: se marca en la lista para
  // saber cuál se eligió (los IDs consecutivos del mismo tramo son casi
  // idénticos a simple vista).
  const [envioResaltado, setEnvioResaltado] = useState(null)

  // Solo un elemento puede estar resaltado a la vez. Al elegir un envío se
  // suelta el resaltado de la unidad de transporte (y viceversa), para que el
  // mapa y el panel no muestren dos selecciones en ámbar simultáneas.
  const resaltarEnvio = (envioId) => {
    setEnvioResaltado(envioId)
    onSelectFlight?.(null)
    onSelectShipment?.(envioId)
  }

  // E18/E21/E23: envíos asociados a cada almacén, separados en los que ENTRAN
  // (el aeropuerto es destino del tramo) y los que SALEN (es origen). Se toman
  // de los envíos planificados y en vuelo, que es la información operativa que
  // pide la rúbrica ("lista planificada de envíos que entran / que salen").
  const enviosPorAlmacen = useMemo(() => {
    const mapa = {}
    const asegurar = (icao) => {
      if (!mapa[icao]) mapa[icao] = { entran: [], salen: [] }
      return mapa[icao]
    }
    const relevantes = [
      ...(enviosOperativos.planificados ?? []),
      ...(enviosOperativos.enVuelo ?? []),
    ]
    relevantes.forEach(envio => {
      const origen = envio.origenIcao ?? envio.desde
      const destino = envio.destinoIcao ?? envio.hasta
      if (origen) asegurar(origen).salen.push(envio)
      if (destino) asegurar(destino).entran.push(envio)
    })
    return mapa
  }, [enviosOperativos])

  // E03/E04: envíos agrupados por vuelo. Se toman de todos los estados
  // operativos (planificados, en vuelo y entregados) para que al abrir una
  // unidad de transporte se vea toda la carga que le fue asignada, no solo la
  // que está en el aire en este instante.
  const enviosPorVuelo = useMemo(() => {
    const mapa = {}
    const todos = [
      ...(enviosOperativos.planificados ?? []),
      ...(enviosOperativos.enVuelo ?? []),
      ...(enviosOperativos.entregados4h ?? []),
    ]
    todos.forEach(envio => {
      const vueloId = envio.flightBusinessId
      if (!vueloId) return
      if (!mapa[vueloId]) mapa[vueloId] = []
      // Un mismo envío puede repetirse entre estados: nos quedamos con uno.
      const id = envio.shipmentId ?? envio.businessId
      if (mapa[vueloId].some(e => (e.shipmentId ?? e.businessId) === id)) return
      mapa[vueloId].push(envio)
    })
    return mapa
  }, [enviosOperativos])

  const cargaActualPorVuelo = useMemo(() => {
    const resultado = {}
    enVuelo.forEach(envio => {
    const vueloId = envio.flightBusinessId
    if (!vueloId) return

    resultado[vueloId] =  (resultado[vueloId] ?? 0) + Number(envio.maletas ?? 0)})
    return resultado
  }, [enVuelo])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    Promise.all([
      getAirports(0, 500).then(p => p.content ?? []).catch(() => []),
      getFlights(0, 1000).then(p => p.content ?? []).catch(() => []),
      getShipments(0, 1000).then(p => p.content ?? []).catch(() => []),
    ]).then(([ap, fl, sh]) => {
      if (!vivo) return
      setAirports(ap); setFlights(fl); setShipments(sh); setCargando(false)
    })
    return () => { vivo = false }
  }, [])

  // Al cambiar de pestaña manualmente, limpiar la búsqueda (cada lista busca
  // distinto). El guardián evita borrarla cuando el cambio de tab lo provocó la
  // selección de un aeropuerto desde el mapa (que sí quiere conservar el ICAO).
  const saltoDesdeMapaRef = useRef(false)
  useEffect(() => {
    if (saltoDesdeMapaRef.current) { saltoDesdeMapaRef.current = false; return }
    setBusqueda('')
  }, [tab])

  // Vinculación mapa→panel: click en un aeropuerto del mapa salta a la pestaña
  // Almacenes y lo busca por su ICAO.
  useEffect(() => {
    if (!airportFromMap?.icao) return
    saltoDesdeMapaRef.current = true
    setTab('almacenes')
    setBusqueda(airportFromMap.icao)
  }, [airportFromMap])

  // F08: click en un avión del mapa → salta a la pestaña Vuelos y abre su
  // detalle de carga. NO se escribe en el buscador: hacerlo dejaba la lista con
  // un único resultado y era imposible seleccionar otro vuelo después.
  useEffect(() => {
    if (!flightFromMap?.id) return
    saltoDesdeMapaRef.current = true
    setTab('vuelos')
    setVueloAbierto(flightFromMap.id)
  }, [flightFromMap])

  const q = busqueda.trim().toLowerCase()

  const fuenteEnvios = useMemo(() => {

    if (estadoEnvio === 'enVuelo') {
      return enviosOperativos.enVuelo ?? []
    }

    if (estadoEnvio === 'entregados4h') {
      return enviosOperativos.entregados4h ?? []
    }

    return enviosOperativos.planificados ?? []

  }, [enviosOperativos, estadoEnvio])

  const almacenesView = useMemo(() => {
    const conCarga = airports.map(ap => {
      const actual = ocupacionPorIcao[ap.codigoIcao] ?? 0
      const cap = ap.capacidadAlmacen || 1
      const pct = Math.round((actual / cap) * 100 * 10) / 10
      return { ...ap, _actual: actual, _pct: pct, _sem: getSemaforoPorOcupacion(pct) }
    })
    const filtrado = q
      ? conCarga.filter(ap =>
          ap.codigoIcao?.toLowerCase().includes(q) ||
          ap.ciudad?.toLowerCase().includes(q) ||
          ap.pais?.toLowerCase().includes(q))
      : conCarga
    return [...filtrado].sort(conDireccion(ORDEN_ALMACENES[orden.almacenes].cmp))
  }, [airports, ocupacionPorIcao, q, orden.almacenes, dirActual])

/*   const vuelosView = useMemo(() => {
    const conPct = flights.map(f => ({ ...f, _pct: flightPct(f), _sem: getSemaforoPorOcupacion(flightPct(f)) }))
    const filtrado = q
      ? conPct.filter(f =>
          f.businessId?.toLowerCase().includes(q) ||
          f.origenIcao?.toLowerCase().includes(q) ||
          f.destinoIcao?.toLowerCase().includes(q))
      : conPct
    return [...filtrado].sort(ORDEN_VUELOS[orden.vuelos].cmp)
  }, [flights, q, orden.vuelos]) */

  const vuelosView = useMemo(() => {
  const conOcupacion = flights.map(f => {
    const capacidad = Number(f.capacidad ?? 0)
    const cargaActual = Number(cargaActualPorVuelo[f.businessId] ?? 0)

    const pct = capacidad > 0
      ? Math.round((cargaActual / capacidad) * 1000) / 10
      : 0

    return {
      ...f,
      _actual: cargaActual,
      _pct: pct,
      _sem: getSemaforoPorOcupacion(pct),
      // Un vuelo "en aire" es el que ahora mismo transporta algún envío. El
      // resto son ocurrencias del catálogo que no están volando en este
      // instante: se muestran, pero sin competir con los que sí tienen carga.
      _enAire: cargaActual > 0,
    }
  })

  // E07/E08/E10/E11: buscar por origen y por destino de forma independiente.
  // Antes se buscaba en un único campo mezclado, así que escribir un ICAO
  // devolvía indistintamente vuelos que salían o que llegaban a él (el
  // profesor lo reportó como "está al revés").
  const filtrado = q
    ? conOcupacion.filter(f => {
        const codigo = String(f.businessId ?? '').toLowerCase()
        const origen = String(f.origenIcao ?? '').toLowerCase()
        const destino = String(f.destinoIcao ?? '').toLowerCase()
        const tramo = `${origen}-${destino}`

        if (campoBusquedaVuelos === 'origen') return origen.includes(q)
        if (campoBusquedaVuelos === 'destino') return destino.includes(q)
        return (
          codigo.includes(q) ||
          origen.includes(q) ||
          destino.includes(q) ||
          tramo.includes(q)
        )
      })
    : conOcupacion

  // El vuelo abierto va siempre primero (así el seleccionado desde el mapa
  // queda visible sin filtrar la lista); después los que llevan carga ahora,
  // que son los que interesan; y dentro de cada grupo, el criterio elegido.
  const cmpElegido = conDireccion(ORDEN_VUELOS[orden.vuelos].cmp)
  return [...filtrado].sort((a, b) =>
    (b.businessId === vueloAbierto) - (a.businessId === vueloAbierto)
    || (b._enAire === true) - (a._enAire === true)
    || cmpElegido(a, b))
}, [flights, cargaActualPorVuelo, q, orden.vuelos, dirActual, campoBusquedaVuelos, vueloAbierto])
/*   const enviosView = useMemo(() => {
    // Match tolerante a los ceros de relleno del ID: "28" encuentra "000000028".
    const qNorm = normalizarId(q)
    const filtrado = q
      ? shipments.filter(s =>
          s.businessId?.toLowerCase().includes(q) ||
          (qNorm && normalizarId(s.businessId) === qNorm) ||
          s.origenIcao?.toLowerCase().includes(q) ||
          s.destinoIcao?.toLowerCase().includes(q) ||
          s.idCliente?.toLowerCase().includes(q))
      : shipments
    return [...filtrado].sort(ORDEN_ENVIOS[orden.envios].cmp)
  }, [shipments, q, orden.envios]) */

  const enviosView = useMemo(() => {
    const qNorm = normalizarId(q)

    const filtrado = q
      ? fuenteEnvios.filter(envio => {
          const envioId = String(
            envio.shipmentId ?? envio.businessId ?? ''
          ).toLowerCase()

          const ut = String(
            envio.flightBusinessId ?? ''
          ).toLowerCase()

          const origen = String(
            envio.origenIcao ?? envio.desde ?? ''
          ).toLowerCase()

          const destino = String(
            envio.destinoIcao ?? envio.hasta ?? ''
          ).toLowerCase()

          const tramo = `${origen}-${destino}`

          return (
            envioId.includes(q) ||
            normalizarId(envioId) === qNorm ||
            ut.includes(q) ||
            origen.includes(q) ||
            destino.includes(q) ||
            tramo.includes(q)
          )
        })
      : fuenteEnvios

    return [...filtrado].sort(
      conDireccion(ORDEN_ENVIOS[orden.envios].cmp)
    )
  }, [fuenteEnvios, q, orden.envios, dirActual])
  
  const ordenActual = { almacenes: ORDEN_ALMACENES, vuelos: ORDEN_VUELOS, envios: ORDEN_ENVIOS }[tab]
  const conteo = { almacenes: almacenesView.length, vuelos: vuelosView.length, envios: enviosView.length }[tab]

  return (
    <div className="flex flex-col border-b border-slate-700">
      {/* Pestañas */}
      <div className="flex bg-slate-900 border-b border-slate-700 sticky top-0 z-10">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              tab === t.id
                ? 'text-blue-300 border-b-2 border-blue-500 bg-slate-800/50'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Búsqueda + orden */}
      <div className="flex items-center gap-1.5 px-2 py-2 bg-slate-900/60">
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar…"
          className="flex-1 min-w-0 bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5 placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />
        <select
          value={orden[tab]}
          onChange={e => setOrden(o => ({ ...o, [tab]: e.target.value }))}
          title="Ordenar"
          className="shrink-0 bg-slate-800 border border-slate-600 text-slate-300 text-xs rounded px-1.5 py-1.5 cursor-pointer focus:outline-none focus:border-blue-500 max-w-[8.5rem]"
        >
          {Object.entries(ordenActual).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        {/* E12–E16: alternar ascendente/descendente sobre el criterio elegido. */}
        <button
          onClick={() => setDir(d => ({ ...d, [tab]: d[tab] === 'asc' ? 'desc' : 'asc' }))}
          title={dirActual === 'asc' ? 'Orden ascendente (clic para invertir)' : 'Orden descendente (clic para invertir)'}
          className="shrink-0 w-8 py-1.5 bg-slate-800 border border-slate-600 text-slate-300 text-xs rounded hover:border-blue-500 hover:text-blue-300 transition-colors"
        >
          {dirActual === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      {/* E07/E08/E10/E11: elegir si la búsqueda aplica al origen, al destino o
          a cualquier campo. Sin esto un ICAO devolvía vuelos que salían y que
          llegaban mezclados. */}
      {tab === 'vuelos' && (
        <div className="grid grid-cols-3 gap-1 px-2 pb-2">
          {[
            { id: 'todo',    label: 'Todo' },
            { id: 'origen',  label: 'Origen' },
            { id: 'destino', label: 'Destino' },
          ].map(op => (
            <button
              key={op.id}
              onClick={() => setCampoBusquedaVuelos(op.id)}
              className={`rounded px-1 py-1.5 text-[10px] transition-colors ${
                campoBusquedaVuelos === op.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {op.label}
            </button>
          ))}
        </div>
      )}{tab === 'envios' && (

        <div className="grid grid-cols-3 gap-1 px-2 pb-2">

          <button
            onClick={() => setEstadoEnvio('planificados')}
            className={`rounded px-1 py-1.5 text-[10px] ${
              estadoEnvio === 'planificados'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            Planificados
          </button>


          <button
            onClick={() => setEstadoEnvio('enVuelo')}
            className={`rounded px-1 py-1.5 text-[10px] ${
              estadoEnvio === 'enVuelo'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            En vuelo
          </button>


          <button
            onClick={() => setEstadoEnvio('entregados4h')}
            className={`rounded px-1 py-1.5 text-[10px] ${
              estadoEnvio === 'entregados4h'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            Entregados
          </button>

        </div>

      )}

      <div className="px-2 pb-1 text-[10px] text-slate-500">{conteo} resultado{conteo === 1 ? '' : 's'}</div>

      {/* Lista scrolleable */}
      <div className="max-h-72 overflow-y-auto divide-y divide-slate-800">
        {cargando ? (
          <p className="px-3 py-6 text-xs text-slate-500 text-center">Cargando…</p>
        ) : conteo === 0 ? (
          <p className="px-3 py-6 text-xs text-slate-500 text-center">Sin resultados.</p>
        ) : tab === 'almacenes' ? (
          almacenesView.map(ap => {
            const flujo = enviosPorAlmacen[ap.codigoIcao] ?? { entran: [], salen: [] }
            const abierto = almacenAbierto === ap.codigoIcao
            const maletasEntran = flujo.entran.reduce((s, e) => s + Number(e.cantidadMaletas ?? 0), 0)
            const maletasSalen = flujo.salen.reduce((s, e) => s + Number(e.cantidadMaletas ?? 0), 0)
            return (
            <div key={ap.codigoIcao}>
              <button
                onClick={() => {
                  setAlmacenAbierto(abierto ? null : ap.codigoIcao)
                  onSelectAirport?.(ap.codigoIcao)
                }}
                className={`w-full text-left px-3 py-2 transition-colors ${
                  // F06: el almacén elegido desde el mapa queda resaltado en la
                  // lista; antes solo se escribía su ICAO en el buscador y el
                  // enlace pasaba desapercibido.
                  airportFromMap?.icao === ap.codigoIcao
                    ? 'bg-blue-500/15 border-l-2 border-blue-400'
                    : abierto ? 'bg-slate-800/80' : 'hover:bg-slate-800/60'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm text-blue-300">{ap.codigoIcao}</span>
                  <SemChip sem={ap._sem} pct={ap._pct} />
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-xs text-slate-400 truncate">{ap.ciudad} · {ap.pais}</span>
                  <span className="text-[11px] text-slate-500 font-mono shrink-0">
                    {ap._actual.toLocaleString()}/{(ap.capacidadAlmacen ?? 0).toLocaleString()}
                  </span>
                </div>
                {/* E21/E23: envíos planificados que entran y que salen. */}
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="text-[10px]">
                    <span className="text-green-400">↓ {flujo.entran.length} entran</span>
                    <span className="text-slate-600"> · </span>
                    <span className="text-amber-400">↑ {flujo.salen.length} salen</span>
                  </span>
                  <span className="text-[10px] text-slate-500">{abierto ? '▲ cerrar' : '▼ ver envíos'}</span>
                </div>
              </button>

              {/* E18: acceso a la lista de envíos del almacén. */}
              {abierto && (
                <div className="bg-slate-900/70 border-t border-slate-800 px-3 py-2 space-y-2">
                  <ListaFlujo
                    titulo={`Entran (${flujo.entran.length} envíos · ${maletasEntran} maletas)`}
                    color="text-green-400"
                    envios={flujo.entran}
                    envioResaltado={envioResaltado}
                    onSelectShipment={resaltarEnvio}
                  />
                  <ListaFlujo
                    titulo={`Salen (${flujo.salen.length} envíos · ${maletasSalen} maletas)`}
                    color="text-amber-400"
                    envios={flujo.salen}
                    envioResaltado={envioResaltado}
                    onSelectShipment={resaltarEnvio}
                  />
                </div>
              )}
            </div>
            )
          })
        ) : tab === 'vuelos' ? (
          vuelosView.map(f => {
            const envios = enviosPorVuelo[f.businessId] ?? []
            const abierto = vueloAbierto === f.businessId
            const maletasTotales = envios.reduce((s, e) => s + Number(e.cantidadMaletas ?? 0), 0)
            return (
            <div key={f.businessId}>
              {/* E03/E04: la fila abre el detalle de la unidad de transporte. */}
              <button
                onClick={() => {
                  const abrir = !abierto
                  setVueloAbierto(abrir ? f.businessId : null)
                  // Solo un elemento resaltado a la vez.
                  setEnvioResaltado(null)
                  // F07: al seleccionar la UT en el panel, enfocarla en el mapa.
                  // Al cerrarla se envía null para quitar el resaltado y poder
                  // elegir otra libremente.
                  onSelectFlight?.(abrir ? f.businessId : null)
                }}
                className={`w-full text-left px-3 py-2 transition-colors ${
                  // El borde ámbar marca "resaltado en el mapa"; si el
                  // resaltado pasó a un envío, el vuelo queda solo desplegado.
                  abierto
                    ? (envioResaltado ? 'bg-slate-800/80' : 'bg-slate-800/80 border-l-2 border-amber-400')
                    : 'hover:bg-slate-800/60'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-200 flex items-center gap-1.5">
                    {/* Distingue de un vistazo los vuelos que están volando ahora
                        de los que son solo programación del día. */}
                    {f._enAire && <span className="text-blue-400" title="En vuelo ahora">✈</span>}
                    {f.origenIcao} → {f.destinoIcao}
                  </span>
                  <SemChip sem={f._sem} pct={f._pct} />
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="font-mono text-[11px] text-slate-500 truncate">{f.businessId}</span>
                  <span className="text-[11px] text-slate-500 font-mono shrink-0">
                    {f.horaSalida?.slice(0, 5)}–{f.horaLlegada?.slice(0, 5)} · {f._actual}/{f.capacidad}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="text-[10px] text-blue-300">
                    {envios.length > 0
                      ? `${envios.length} envío${envios.length === 1 ? '' : 's'} · ${maletasTotales} maleta${maletasTotales === 1 ? '' : 's'}`
                      : 'Sin envíos asignados'}
                  </span>
                  <span className="text-[10px] text-slate-500">{abierto ? '▲ cerrar' : '▼ ver carga'}</span>
                </div>
              </button>

              {/* E03: envíos que traslada. E04: productos (maletas) de cada uno. */}
              {abierto && (
                <div className="bg-slate-900/70 border-t border-slate-800 px-3 py-2">
                  {envios.length === 0 ? (
                    <p className="text-[11px] text-slate-500 py-1">
                      Este vuelo no transporta envíos en la planificación actual.
                    </p>
                  ) : (
                    <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                      {envios.map((e, i) => {
                        const envioId = e.shipmentId ?? e.businessId
                        const marcado = envioResaltado === envioId
                        return (
                          <li key={`${envioId}-${i}`}>
                            <button
                              onClick={() => resaltarEnvio(envioId)}
                              className={`w-full text-left rounded px-2 py-1.5 transition-colors ${
                                marcado
                                  ? 'bg-amber-500/20 border-l-2 border-amber-400'
                                  : 'bg-slate-800/60 hover:bg-slate-700/60'}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[11px] text-blue-300 truncate">{envioId}</span>
                                <span className="font-mono text-[11px] text-slate-300 shrink-0">
                                  {e.cantidadMaletas ?? 0} mal.
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400 mt-0.5">
                                <span>{e.origenIcao ?? e.desde} → {e.destinoIcao ?? e.hasta}</span>
                                <span className="text-slate-500">{e.estado ?? ''}</span>
                              </div>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
            )
          })
        ) : (
          enviosView.map((envio, index) => {
            const envioId =
              envio.shipmentId ??
              envio.businessId

            const origen =
              envio.origenIcao ??
              envio.desde

            const destino =
              envio.destinoIcao ??
              envio.hasta

            return (
              <button
                key={`${envioId}-${envio.flightBusinessId}-${index}`}
                onClick={() => resaltarEnvio(envioId)}
                className={`w-full text-left px-3 py-2 transition-colors ${
                  envioResaltado === envioId
                    ? 'bg-amber-500/15 border-l-2 border-amber-400'
                    : 'hover:bg-slate-800/60'}`}
              >
                {/* ID + maletas */}
                <div className="
                  flex
                  items-center
                  justify-between
                  gap-2
                ">

                  <span className="
                    font-mono
                    text-sm
                    text-blue-300
                  ">

                    {envioId}

                  </span>


                  <span className="
                    font-mono
                    text-xs
                    text-slate-300
                  ">

                    {envio.cantidadMaletas ?? 0} mal.

                  </span>

                </div>


                {/* Origen → destino + UT */}

                <div className="
                  flex
                  items-center
                  justify-between
                  mt-1
                  gap-2
                ">

                  <span className="
                    text-xs
                    text-slate-300
                  ">

                    {origen} → {destino}

                  </span>


                  <span className="
                    text-[10px]
                    text-amber-300
                    font-mono
                  ">

                    UT: {envio.flightBusinessId ?? 'Sin asignar'}

                  </span>

                </div>


                {/* Horarios */}

                <div className="
                  flex
                  items-center
                  justify-between
                  mt-1
                  text-[10px]
                  text-slate-500
                ">

                  <span>

                    Sale: {
                      envio.salida
                        ? fmtFecha(envio.salida)
                        : '—'
                    }

                  </span>


                  <span>

                    Llega: {
                      envio.llegada
                        ? fmtFecha(envio.llegada)
                        : '—'
                    }

                  </span>

                </div>


                {/* Progreso solo si está en vuelo */}

                {estadoEnvio === 'enVuelo' && (

                  <div className="
                    mt-2
                    h-1
                    rounded
                    bg-slate-700
                    overflow-hidden
                  ">

                    <div

                      className="
                        h-full
                        bg-blue-500
                      "

                      style={{
                        width: `${
                          Math.min(
                            100,
                            (envio.progreso ?? 0) * 100
                          )
                        }%`
                      }}

                    />

                  </div>

                )}

              </button>

            )

          })
/*           enviosView.map(s => (
            <button
              key={s.businessId}
              onClick={() => onSelectShipment?.(s.businessId)}
              className="w-full text-left px-3 py-2 hover:bg-slate-800/60 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm text-blue-300">{s.businessId}</span>
                <span className="font-mono text-xs text-slate-400 shrink-0">{s.cantidadMaletas} mal.</span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="text-xs text-slate-300">{s.origenIcao} → {s.destinoIcao}</span>
                {s.esMustGo && <span className="text-[10px] font-bold text-amber-400 uppercase">Must-go</span>}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Deadline: {fmtFecha(s.deadline)}</div>
            </button>
          )) */
        )}
      </div>
    </div>
  )
}

// E18/E21/E23: bloque de envíos que entran o salen de un almacén. Cada envío
// es clicable para resaltar su ruta en el mapa.
function ListaFlujo({ titulo, color, envios, envioResaltado, onSelectShipment }) {
  return (
    <div>
      <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${color}`}>{titulo}</div>
      {envios.length === 0 ? (
        <p className="text-[11px] text-slate-500 pb-1">Sin envíos planificados.</p>
      ) : (
        <ul className="space-y-1 max-h-36 overflow-y-auto">
          {envios.slice(0, 40).map((e, i) => {
            const envioId = e.shipmentId ?? e.businessId
            const marcado = envioResaltado === envioId
            return (
              <li key={`${envioId}-${i}`}>
                <button
                  onClick={() => onSelectShipment?.(envioId)}
                  className={`w-full text-left rounded px-2 py-1 transition-colors ${
                    marcado
                      ? 'bg-amber-500/20 border-l-2 border-amber-400'
                      : 'bg-slate-800/60 hover:bg-slate-700/60'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-blue-300 truncate">{envioId}</span>
                    <span className="font-mono text-[11px] text-slate-300 shrink-0">
                      {e.cantidadMaletas ?? 0} mal.
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400 mt-0.5">
                    <span>{e.origenIcao ?? e.desde} → {e.destinoIcao ?? e.hasta}</span>
                    <span className="text-slate-500 font-mono">{e.flightBusinessId ?? ''}</span>
                  </div>
                </button>
              </li>
            )
          })}
          {envios.length > 40 && (
            <li className="text-[10px] text-slate-500 px-2 pt-1">
              …y {envios.length - 40} envíos más
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

// Chip de semáforo de carga (color + etiqueta neutral + %).
function SemChip({ sem, pct }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SEMAFORO_COLORES[sem] }} />
      <span className="text-[11px] text-slate-400">{SEM_LABEL[sem]} {pct}%</span>
    </span>
  )
}
