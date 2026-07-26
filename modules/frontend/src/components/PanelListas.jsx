import { useState, useEffect, useMemo, useRef } from 'react'
import {
  getAirports,
  getFlights,
  getShipments,
  getPlanningRunRoutes,
} from '../services/api'
import { SEMAFORO_COLORES, getSemaforoPorOcupacion } from '../data/aeropuertos'

// Panel de control con las tres listas operativas del Dashboard:
// almacenes, unidades de transporte (vuelos) y envíos.
const TABS = [
  { id: 'almacenes', label: 'Almacenes' },
  { id: 'vuelos', label: 'UT' },
  { id: 'envios', label: 'Envíos' },
]

const SEM_LABEL = {
  vacio: 'Vacío',
  verde: 'Baja carga',
  ambar: 'Carga media',
  rojo: 'Carga alta',
}

const ORDEN_ALMACENES = {
  icao: { label: 'Código', cmp: (a, b) => compararTexto(a.codigoIcao, b.codigoIcao) },
  ciudad: { label: 'Ciudad', cmp: (a, b) => compararTexto(a.ciudad, b.ciudad) },
  capacidad: { label: 'Capacidad', cmp: (a, b) => compararNumero(a.capacidadAlmacen, b.capacidadAlmacen) },
  carga: { label: 'Ocupación', cmp: (a, b) => compararNumero(a._pct, b._pct) },
}

const ORDEN_VUELOS = {
  ocupacion: { label: 'Ocupación', cmp: (a, b) => compararNumero(a._pct, b._pct) },
  salida: { label: 'Hora de salida', cmp: (a, b) => compararHora(a.horaSalida, b.horaSalida) },
  origen: { label: 'Origen', cmp: (a, b) => compararTexto(a.origenIcao, b.origenIcao) },
  destino: { label: 'Destino', cmp: (a, b) => compararTexto(a.destinoIcao, b.destinoIcao) },
}

const ORDEN_ENVIOS = {
  deadline: { label: 'Deadline', cmp: (a, b) => compararTexto(a.deadline, b.deadline) },
  maletas: { label: 'Maletas', cmp: (a, b) => compararNumero(a.cantidadMaletas, b.cantidadMaletas) },
  prioridad: { label: 'Prioridad', cmp: (a, b) => compararNumero(a.prioridad, b.prioridad) },
  id: {
    label: 'ID',
    cmp: (a, b) => compararTexto(
      a.shipmentId ?? a.businessId,
      b.shipmentId ?? b.businessId,
    ),
  },
}

function compararTexto(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'es', {
    numeric: true,
    sensitivity: 'base',
  })
}

function compararNumero(a, b) {
  return Number(a ?? 0) - Number(b ?? 0)
}

function compararHora(a, b) {
  return horaAMinutos(a) - horaAMinutos(b)
}

function horaAMinutos(valor) {
  if (!valor) return Number.MAX_SAFE_INTEGER
  const texto = String(valor).trim()
  const match = texto.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i)
  if (!match) return Number.MAX_SAFE_INTEGER

  let hora = Number(match[1])
  const minuto = Number(match[2])
  const periodo = match[3]?.toUpperCase()

  if (periodo === 'AM' && hora === 12) hora = 0
  if (periodo === 'PM' && hora < 12) hora += 12
  return hora * 60 + minuto
}

function normalizarId(id) {
  const texto = String(id ?? '').trim().toLowerCase()
  return /^\d+$/.test(texto) ? String(parseInt(texto, 10)) : texto
}

function normalizarVueloId(id) {
  const texto = String(id ?? '').trim()
  const indiceSeparador = texto.indexOf('@')
  return indiceSeparador >= 0 ? texto.slice(0, indiceSeparador) : texto
}

function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function textoUbicacion(codigo, aeropuerto) {
  return normalizarTexto([
    codigo,
    aeropuerto?.codigoIcao,
    aeropuerto?.nombre,
    aeropuerto?.ciudad,
    aeropuerto?.pais,
    aeropuerto?.continente,
  ].filter(Boolean).join(' '))
}

function fmtHora(hora) {
  if (!hora) return '—'
  const match = String(hora).match(/^(\d{1,2}):(\d{2})/)
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : String(hora)
}

function fmtFecha(iso) {
  if (!iso) return '—'
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return String(iso)
  const p = numero => String(numero).padStart(2, '0')
  return `${p(fecha.getDate())}/${p(fecha.getMonth() + 1)} ${p(fecha.getHours())}:${p(fecha.getMinutes())}`
}

function productosDeRuta(ruta) {
  const productos = ruta.productos ?? ruta.items ?? ruta.detalleProductos

  if (Array.isArray(productos) && productos.length > 0) {
    return productos.map((producto, indice) => ({
      key: `${ruta.shipmentBusinessId}-producto-${indice}`,
      envio: ruta.shipmentBusinessId,
      producto:
        producto.nombre ??
        producto.descripcion ??
        producto.codigo ??
        producto.sku ??
        `Producto ${indice + 1}`,
      cantidad: Number(producto.cantidad ?? producto.unidades ?? 1),
      esFallback: false,
    }))
  }

  // El modelo actual trabaja principalmente con maletas. Mientras el backend
  // no exponga productos, se presenta la carga disponible del envío.
  return [{
    key: `${ruta.shipmentBusinessId}-carga`,
    envio: ruta.shipmentBusinessId,
    producto: 'Maletas / carga del envío',
    cantidad: Number(ruta.cantidadMaletas ?? 0),
    esFallback: true,
  }]
}

export default function PanelListas({
  runId,
  enVuelo = [],
  enviosOperativos = {
    planificados: [],
    enVuelo: [],
    entregados4h: [],
  },
  ocupacionPorIcao = {},
  airportFromMap,
  onSelectAirport,
  onSelectShipment,
}) {
  const [tab, setTab] = useState('almacenes')
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState({
    almacenes: 'icao',
    vuelos: 'ocupacion',
    envios: 'deadline',
  })
  const [direccion, setDireccion] = useState({
    almacenes: 'asc',
    vuelos: 'desc',
    envios: 'asc',
  })

  const [busquedaUtOrigen, setBusquedaUtOrigen] = useState('')
  const [busquedaUtDestino, setBusquedaUtDestino] = useState('')
  const [filtroUtOrigen, setFiltroUtOrigen] = useState('Todos')
  const [filtroUtDestino, setFiltroUtDestino] = useState('Todos')
  const [detalleUt, setDetalleUt] = useState({ codigo: null, vista: 'envios' })

  const [airports, setAirports] = useState([])
  const [flights, setFlights] = useState([])
  const [shipments, setShipments] = useState([])
  const [routes, setRoutes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [estadoEnvio, setEstadoEnvio] = useState('planificados')

  useEffect(() => {
    let vivo = true
    setCargando(true)

    Promise.all([
      getAirports(0, 500).then(pagina => pagina?.content ?? []).catch(() => []),
      getFlights(0, 2000).then(pagina => pagina?.content ?? []).catch(() => []),
      getShipments(0, 1000).then(pagina => pagina?.content ?? []).catch(() => []),
    ]).then(([aeropuertos, vuelos, envios]) => {
      if (!vivo) return
      setAirports(aeropuertos)
      setFlights(vuelos)
      setShipments(envios)
      setCargando(false)
    })

    return () => { vivo = false }
  }, [])

  useEffect(() => {
    if (!runId) {
      setRoutes([])
      return
    }

    let vivo = true
    getPlanningRunRoutes(runId)
      .then(lista => {
        if (vivo) setRoutes(Array.isArray(lista) ? lista : [])
      })
      .catch(() => {
        if (vivo) setRoutes([])
      })

    return () => { vivo = false }
  }, [runId])

  const saltoDesdeMapaRef = useRef(false)
  useEffect(() => {
    if (saltoDesdeMapaRef.current) {
      saltoDesdeMapaRef.current = false
      return
    }
    setBusqueda('')
  }, [tab])

  useEffect(() => {
    if (!airportFromMap?.icao) return
    saltoDesdeMapaRef.current = true
    setTab('almacenes')
    setBusqueda(airportFromMap.icao)
  }, [airportFromMap])

  const airportMap = useMemo(
    () => new Map(airports.map(aeropuerto => [aeropuerto.codigoIcao, aeropuerto])),
    [airports],
  )

  const enviosPorVuelo = useMemo(() => {
    const resultado = new Map()

    routes.forEach(ruta => {
      const ids = ruta.flightBusinessIds ?? []
      ids.forEach(id => {
        const vueloId = normalizarVueloId(id)
        if (!vueloId) return
        const actuales = resultado.get(vueloId) ?? []
        actuales.push({
          envio: ruta.shipmentBusinessId,
          desde: ruta.origenIcao,
          hasta: ruta.destinoIcao,
          maletas: Number(ruta.cantidadMaletas ?? 0),
          directa: ruta.esDirecta,
          escalas: Number(ruta.escalas ?? 0),
          rutaOriginal: ruta,
        })
        resultado.set(vueloId, actuales)
      })
    })

    resultado.forEach(lista => {
      lista.sort((a, b) => b.maletas - a.maletas || compararTexto(a.envio, b.envio))
    })

    return resultado
  }, [routes])

  const productosPorVuelo = useMemo(() => {
    const resultado = new Map()

    enviosPorVuelo.forEach((envios, vueloId) => {
      const productos = envios
        .flatMap(envio => productosDeRuta(envio.rutaOriginal))
        .sort((a, b) => b.cantidad - a.cantidad || compararTexto(a.envio, b.envio))
      resultado.set(vueloId, productos)
    })

    return resultado
  }, [enviosPorVuelo])

  const cargaPorVuelo = useMemo(() => {
    const resultado = {}

    // La carga asignada del run permite ordenar todas las UT, incluso aquellas
    // que todavía no despegaron en el instante actual de la simulación.
    enviosPorVuelo.forEach((envios, vueloId) => {
      resultado[vueloId] = envios.reduce((total, envio) => total + envio.maletas, 0)
    })

    // Fallback para el modo en vivo mientras las rutas aún no estén persistidas.
    if (enviosPorVuelo.size === 0) {
      enVuelo.forEach(envio => {
        const vueloId = normalizarVueloId(envio.flightBusinessId)
        if (!vueloId) return
        resultado[vueloId] =
          (resultado[vueloId] ?? 0) + Number(envio.maletas ?? envio.cantidadMaletas ?? 0)
      })
    }

    return resultado
  }, [enviosPorVuelo, enVuelo])

  const origenesUT = useMemo(() => {
    const codigos = [...new Set(flights.map(vuelo => vuelo.origenIcao).filter(Boolean))]
    return codigos.sort(compararTexto)
  }, [flights])

  const destinosUT = useMemo(() => {
    const codigos = [...new Set(flights.map(vuelo => vuelo.destinoIcao).filter(Boolean))]
    return codigos.sort(compararTexto)
  }, [flights])

  const q = normalizarTexto(busqueda)

  const almacenesView = useMemo(() => {
    const preparados = airports.map(aeropuerto => {
      const actual = Number(ocupacionPorIcao[aeropuerto.codigoIcao] ?? 0)
      const capacidad = Number(aeropuerto.capacidadAlmacen ?? 0)
      const pct = capacidad > 0 ? Math.round((actual / capacidad) * 1000) / 10 : 0
      return {
        ...aeropuerto,
        _actual: actual,
        _pct: pct,
        _sem: getSemaforoPorOcupacion(pct),
      }
    })

    const filtrados = q
      ? preparados.filter(aeropuerto => textoUbicacion(aeropuerto.codigoIcao, aeropuerto).includes(q))
      : preparados

    const multiplicador = direccion.almacenes === 'asc' ? 1 : -1
    return [...filtrados].sort((a, b) => multiplicador * ORDEN_ALMACENES[orden.almacenes].cmp(a, b))
  }, [airports, ocupacionPorIcao, q, orden.almacenes, direccion.almacenes])

  const vuelosView = useMemo(() => {
    const busquedaOrigen = normalizarTexto(busquedaUtOrigen)
    const busquedaDestino = normalizarTexto(busquedaUtDestino)

    const preparados = flights.map(vuelo => {
      const codigo = normalizarVueloId(vuelo.businessId ?? vuelo.id)
      const origenInfo = airportMap.get(vuelo.origenIcao)
      const destinoInfo = airportMap.get(vuelo.destinoIcao)
      const carga = Number(cargaPorVuelo[codigo] ?? 0)
      const capacidad = Number(vuelo.capacidad ?? 0)
      const pct = capacidad > 0 ? Math.round((carga / capacidad) * 1000) / 10 : 0

      return {
        ...vuelo,
        businessId: codigo,
        _actual: carga,
        _pct: pct,
        _sem: getSemaforoPorOcupacion(pct),
        _origenTexto: textoUbicacion(vuelo.origenIcao, origenInfo),
        _destinoTexto: textoUbicacion(vuelo.destinoIcao, destinoInfo),
        _origenDetalle: origenInfo?.ciudad ?? origenInfo?.nombre ?? '',
        _destinoDetalle: destinoInfo?.ciudad ?? destinoInfo?.nombre ?? '',
      }
    })

    const filtrados = preparados.filter(vuelo => {
      const coincideBusquedaGeneral = !q || [
        vuelo.businessId,
        vuelo._origenTexto,
        vuelo._destinoTexto,
      ].some(valor => normalizarTexto(valor).includes(q))

      const coincideOrigen =
        !busquedaOrigen || vuelo._origenTexto.includes(busquedaOrigen)
      const coincideDestino =
        !busquedaDestino || vuelo._destinoTexto.includes(busquedaDestino)
      const coincideFiltroOrigen =
        filtroUtOrigen === 'Todos' || vuelo.origenIcao === filtroUtOrigen
      const coincideFiltroDestino =
        filtroUtDestino === 'Todos' || vuelo.destinoIcao === filtroUtDestino

      return coincideBusquedaGeneral && coincideOrigen && coincideDestino &&
        coincideFiltroOrigen && coincideFiltroDestino
    })

    const multiplicador = direccion.vuelos === 'asc' ? 1 : -1
    return [...filtrados].sort((a, b) => {
      const comparacion = ORDEN_VUELOS[orden.vuelos].cmp(a, b)
      return multiplicador * comparacion || compararTexto(a.businessId, b.businessId)
    })
  }, [
    flights,
    airportMap,
    cargaPorVuelo,
    q,
    busquedaUtOrigen,
    busquedaUtDestino,
    filtroUtOrigen,
    filtroUtDestino,
    orden.vuelos,
    direccion.vuelos,
  ])

  const fuenteEnvios = useMemo(() => {
    const operativos = enviosOperativos ?? {}
    let lista

    if (estadoEnvio === 'enVuelo') lista = operativos.enVuelo
    else if (estadoEnvio === 'entregados4h') lista = operativos.entregados4h
    else lista = operativos.planificados

    if (Array.isArray(lista) && lista.length > 0) return lista
    return estadoEnvio === 'planificados' ? shipments : []
  }, [enviosOperativos, estadoEnvio, shipments])

  const enviosView = useMemo(() => {
    const qNormalizado = normalizarId(q)
    const filtrados = q
      ? fuenteEnvios.filter(envio => {
          const envioId = normalizarTexto(envio.shipmentId ?? envio.businessId)
          const ut = normalizarTexto(envio.flightBusinessId)
          const origen = normalizarTexto(envio.origenIcao ?? envio.desde)
          const destino = normalizarTexto(envio.destinoIcao ?? envio.hasta)

          return envioId.includes(q) ||
            normalizarId(envioId) === qNormalizado ||
            ut.includes(q) ||
            origen.includes(q) ||
            destino.includes(q) ||
            `${origen}-${destino}`.includes(q)
        })
      : fuenteEnvios

    const multiplicador = direccion.envios === 'asc' ? 1 : -1
    return [...filtrados].sort((a, b) => multiplicador * ORDEN_ENVIOS[orden.envios].cmp(a, b))
  }, [fuenteEnvios, q, orden.envios, direccion.envios])

  const ordenActual = {
    almacenes: ORDEN_ALMACENES,
    vuelos: ORDEN_VUELOS,
    envios: ORDEN_ENVIOS,
  }[tab]

  const conteo = {
    almacenes: almacenesView.length,
    vuelos: vuelosView.length,
    envios: enviosView.length,
  }[tab]

  function cambiarTab(tabId) {
    setTab(tabId)
    setDetalleUt({ codigo: null, vista: 'envios' })
  }

  function alternarDetalleUt(codigo, vista) {
    setDetalleUt(actual => {
      if (actual.codigo === codigo && actual.vista === vista) {
        return { codigo: null, vista }
      }
      return { codigo, vista }
    })
  }

  function limpiarFiltrosUt() {
    setBusqueda('')
    setBusquedaUtOrigen('')
    setBusquedaUtDestino('')
    setFiltroUtOrigen('Todos')
    setFiltroUtDestino('Todos')
    setDetalleUt({ codigo: null, vista: 'envios' })
  }

  return (
    <div className="flex flex-col border-b border-slate-700">
      <div className="flex bg-slate-900 border-b border-slate-700 sticky top-0 z-10">
        {TABS.map(item => (
          <button
            type="button"
            key={item.id}
            onClick={() => cambiarTab(item.id)}
            className={`flex-1 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              tab === item.id
                ? 'text-blue-300 border-b-2 border-blue-500 bg-slate-800/50'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'vuelos' ? (
        <div className="px-2 py-2 space-y-2 bg-slate-900/60 border-b border-slate-800">
          <input
            value={busqueda}
            onChange={evento => setBusqueda(evento.target.value)}
            placeholder="Buscar UT por código o ubicación"
            className="w-full bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1.5 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />

          <div className="grid grid-cols-2 gap-1.5">
            <input
              value={busquedaUtOrigen}
              onChange={evento => setBusquedaUtOrigen(evento.target.value)}
              placeholder="Buscar en origen"
              title="Busca por almacén, ciudad, aeropuerto o código de origen"
              className="min-w-0 bg-slate-800 border border-slate-600 text-slate-200 text-[11px] rounded px-2 py-1.5 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <input
              value={busquedaUtDestino}
              onChange={evento => setBusquedaUtDestino(evento.target.value)}
              placeholder="Buscar en destino"
              title="Busca por almacén, ciudad, aeropuerto o código de destino"
              className="min-w-0 bg-slate-800 border border-slate-600 text-slate-200 text-[11px] rounded px-2 py-1.5 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <select
              value={filtroUtOrigen}
              onChange={evento => setFiltroUtOrigen(evento.target.value)}
              title="Filtrar UT por origen"
              className="min-w-0 bg-slate-800 border border-slate-600 text-slate-300 text-[11px] rounded px-1.5 py-1.5 focus:outline-none focus:border-blue-500"
            >
              <option value="Todos">Origen: todos</option>
              {origenesUT.map(codigo => (
                <option key={codigo} value={codigo}>
                  {codigo}{airportMap.get(codigo)?.ciudad ? ` — ${airportMap.get(codigo).ciudad}` : ''}
                </option>
              ))}
            </select>

            <select
              value={filtroUtDestino}
              onChange={evento => setFiltroUtDestino(evento.target.value)}
              title="Filtrar UT por destino"
              className="min-w-0 bg-slate-800 border border-slate-600 text-slate-300 text-[11px] rounded px-1.5 py-1.5 focus:outline-none focus:border-blue-500"
            >
              <option value="Todos">Destino: todos</option>
              {destinosUT.map(codigo => (
                <option key={codigo} value={codigo}>
                  {codigo}{airportMap.get(codigo)?.ciudad ? ` — ${airportMap.get(codigo).ciudad}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-1.5">
            <select
              value={orden.vuelos}
              onChange={evento => setOrden(actual => ({ ...actual, vuelos: evento.target.value }))}
              title="Ordenar lista de UT"
              className="flex-1 min-w-0 bg-slate-800 border border-slate-600 text-slate-300 text-[11px] rounded px-1.5 py-1.5 focus:outline-none focus:border-blue-500"
            >
              {Object.entries(ORDEN_VUELOS).map(([clave, configuracion]) => (
                <option key={clave} value={clave}>Ordenar: {configuracion.label}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setDireccion(actual => ({
                ...actual,
                vuelos: actual.vuelos === 'asc' ? 'desc' : 'asc',
              }))}
              title={direccion.vuelos === 'asc' ? 'Orden ascendente' : 'Orden descendente'}
              className="w-9 rounded border border-slate-600 bg-slate-800 text-slate-300 hover:text-white"
            >
              {direccion.vuelos === 'asc' ? '▲' : '▼'}
            </button>

            <button
              type="button"
              onClick={limpiarFiltrosUt}
              title="Limpiar búsqueda y filtros de UT"
              className="px-2 rounded border border-slate-600 bg-slate-800 text-[10px] text-slate-400 hover:text-white"
            >
              Limpiar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-2 py-2 bg-slate-900/60">
          <input
            value={busqueda}
            onChange={evento => setBusqueda(evento.target.value)}
            placeholder="Buscar…"
            className="flex-1 min-w-0 bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <select
            value={orden[tab]}
            onChange={evento => setOrden(actual => ({ ...actual, [tab]: evento.target.value }))}
            title="Ordenar"
            className="shrink-0 bg-slate-800 border border-slate-600 text-slate-300 text-xs rounded px-1.5 py-1.5 cursor-pointer focus:outline-none focus:border-blue-500 max-w-[7.5rem]"
          >
            {Object.entries(ordenActual).map(([clave, configuracion]) => (
              <option key={clave} value={clave}>{configuracion.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setDireccion(actual => ({
              ...actual,
              [tab]: actual[tab] === 'asc' ? 'desc' : 'asc',
            }))}
            className="w-8 rounded border border-slate-600 bg-slate-800 text-slate-300"
            title={direccion[tab] === 'asc' ? 'Orden ascendente' : 'Orden descendente'}
          >
            {direccion[tab] === 'asc' ? '▲' : '▼'}
          </button>
        </div>
      )}

      {tab === 'envios' && (
        <div className="grid grid-cols-3 gap-1 px-2 pb-2 bg-slate-900/60">
          {[
            ['planificados', 'Planificados'],
            ['enVuelo', 'En vuelo'],
            ['entregados4h', 'Entregados'],
          ].map(([estado, etiqueta]) => (
            <button
              type="button"
              key={estado}
              onClick={() => setEstadoEnvio(estado)}
              className={`rounded px-1 py-1.5 text-[10px] ${
                estadoEnvio === estado
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {etiqueta}
            </button>
          ))}
        </div>
      )}

      <div className="px-2 py-1 text-[10px] text-slate-500 bg-slate-900/60">
        {conteo} resultado{conteo === 1 ? '' : 's'}
      </div>

      <div className="max-h-[34rem] overflow-y-auto divide-y divide-slate-800">
        {cargando ? (
          <p className="px-3 py-6 text-xs text-slate-500 text-center">Cargando…</p>
        ) : conteo === 0 ? (
          <p className="px-3 py-6 text-xs text-slate-500 text-center">Sin resultados.</p>
        ) : tab === 'almacenes' ? (
          almacenesView.map(aeropuerto => (
            <button
              type="button"
              key={aeropuerto.codigoIcao}
              onClick={() => onSelectAirport?.(aeropuerto.codigoIcao)}
              className="w-full text-left px-3 py-2 hover:bg-slate-800/60 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm text-blue-300">{aeropuerto.codigoIcao}</span>
                <SemChip sem={aeropuerto._sem} pct={aeropuerto._pct} />
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="text-xs text-slate-400 truncate">
                  {aeropuerto.ciudad} · {aeropuerto.pais}
                </span>
                <span className="text-[11px] text-slate-500 font-mono shrink-0">
                  {aeropuerto._actual.toLocaleString()}/
                  {Number(aeropuerto.capacidadAlmacen ?? 0).toLocaleString()}
                </span>
              </div>
            </button>
          ))
        ) : tab === 'vuelos' ? (
          vuelosView.map(vuelo => {
            const abierto = detalleUt.codigo === vuelo.businessId
            const envios = enviosPorVuelo.get(vuelo.businessId) ?? []
            const productos = productosPorVuelo.get(vuelo.businessId) ?? []

            return (
              <div key={vuelo.businessId} className={abierto ? 'bg-slate-800/35' : ''}>
                <div className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold text-blue-300 truncate">
                          {vuelo.businessId}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {fmtHora(vuelo.horaSalida)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-200 mt-0.5">
                        {vuelo.origenIcao} → {vuelo.destinoIcao}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {vuelo._origenDetalle || vuelo.origenIcao} → {vuelo._destinoDetalle || vuelo.destinoIcao}
                      </div>
                    </div>
                    <SemChip sem={vuelo._sem} pct={vuelo._pct} />
                  </div>

                  <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500">
                    <span>
                      Carga: {vuelo._actual.toLocaleString()}/{Number(vuelo.capacidad ?? 0).toLocaleString()}
                    </span>
                    <span>Llega: {fmtHora(vuelo.horaLlegada)}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 mt-2">
                    <button
                      type="button"
                      onClick={() => alternarDetalleUt(vuelo.businessId, 'envios')}
                      className={`rounded border px-2 py-1 text-[10px] transition-colors ${
                        abierto && detalleUt.vista === 'envios'
                          ? 'border-blue-400 bg-blue-500/15 text-blue-200'
                          : 'border-slate-600 text-slate-400 hover:text-blue-300 hover:border-blue-500/60'
                      }`}
                    >
                      {abierto && detalleUt.vista === 'envios' ? 'Ocultar envíos' : `Ver envíos (${envios.length})`}
                    </button>
                    <button
                      type="button"
                      onClick={() => alternarDetalleUt(vuelo.businessId, 'productos')}
                      className={`rounded border px-2 py-1 text-[10px] transition-colors ${
                        abierto && detalleUt.vista === 'productos'
                          ? 'border-violet-400 bg-violet-500/15 text-violet-200'
                          : 'border-slate-600 text-slate-400 hover:text-violet-300 hover:border-violet-500/60'
                      }`}
                    >
                      {abierto && detalleUt.vista === 'productos' ? 'Ocultar productos' : `Ver productos (${productos.length})`}
                    </button>
                  </div>
                </div>

                {abierto && (
                  <div className="border-t border-slate-700 bg-slate-950/45 px-3 py-2">
                    {detalleUt.vista === 'envios' ? (
                      <DetalleEnviosUT envios={envios} onSelectShipment={onSelectShipment} />
                    ) : (
                      <DetalleProductosUT productos={productos} />
                    )}
                  </div>
                )}
              </div>
            )
          })
        ) : (
          enviosView.map((envio, index) => {
            const envioId = envio.shipmentId ?? envio.businessId
            const origen = envio.origenIcao ?? envio.desde
            const destino = envio.destinoIcao ?? envio.hasta

            return (
              <button
                type="button"
                key={`${envioId}-${envio.flightBusinessId ?? 'sin-ut'}-${index}`}
                onClick={() => onSelectShipment?.(envioId)}
                className="w-full text-left px-3 py-2 hover:bg-slate-800/60 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm text-blue-300">{envioId}</span>
                  <span className="font-mono text-xs text-slate-300">
                    {Number(envio.cantidadMaletas ?? envio.maletas ?? 0)} mal.
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1 gap-2">
                  <span className="text-xs text-slate-300">{origen} → {destino}</span>
                  <span className="text-[10px] text-amber-300 font-mono">
                    UT: {envio.flightBusinessId ?? 'Sin asignar'}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500">
                  <span>Sale: {fmtFecha(envio.salida ?? envio.tiempoInicio)}</span>
                  <span>Llega: {fmtFecha(envio.llegada ?? envio.tiempoLlegadaEstimado)}</span>
                </div>
                {estadoEnvio === 'enVuelo' && (
                  <div className="mt-2 h-1 rounded bg-slate-700 overflow-hidden">
                    <div
                      className="h-full bg-blue-500"
                      style={{ width: `${Math.min(100, Number(envio.progreso ?? 0) * 100)}%` }}
                    />
                  </div>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function DetalleEnviosUT({ envios, onSelectShipment }) {
  if (envios.length === 0) {
    return <p className="text-[11px] text-slate-500">Sin envíos asociados a esta UT.</p>
  }

  return (
    <div>
      <p className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">
        Envíos que traslada
      </p>
      <div className="space-y-1.5">
        {envios.map((envio, index) => (
          <button
            type="button"
            key={`${envio.envio}-${index}`}
            onClick={() => onSelectShipment?.(envio.envio)}
            className="w-full rounded border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-left hover:border-blue-500/50"
          >
            <div className="flex justify-between gap-2">
              <span className="font-mono text-[11px] text-blue-300">{envio.envio}</span>
              <span className="font-mono text-[10px] text-slate-400">{envio.maletas} mal.</span>
            </div>
            <div className="mt-0.5 flex justify-between gap-2 text-[10px] text-slate-500">
              <span>{envio.desde} → {envio.hasta}</span>
              <span>{envio.directa ? 'Directo' : `${envio.escalas} escala(s)`}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function DetalleProductosUT({ productos }) {
  if (productos.length === 0) {
    return <p className="text-[11px] text-slate-500">Sin productos o carga asociados a esta UT.</p>
  }

  const usaFallback = productos.every(producto => producto.esFallback)

  return (
    <div>
      <div className="mb-1.5">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">Productos que traslada</p>
       {/*  {usaFallback && (
          <p className="mt-0.5 text-[10px] text-amber-400/80">
            El backend aún no expone productos; se muestra la carga en maletas.
          </p>
        )} */}
      </div>
      <div className="space-y-1.5">
        {productos.map(producto => (
          <div
            key={producto.key}
            className="rounded border border-slate-800 bg-slate-900/60 px-2 py-1.5"
          >
            <div className="flex justify-between gap-2">
              <span className="text-[11px] text-violet-200">{producto.producto}</span>
              <span className="font-mono text-[10px] text-slate-300">{producto.cantidad}</span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-slate-500">
              Envío: {producto.envio}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SemChip({ sem, pct }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      <span
        className="w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: SEMAFORO_COLORES[sem] }}
      />
      <span className="text-[10px] text-slate-400">
        {SEM_LABEL[sem]} {Number(pct ?? 0).toFixed(1)}%
      </span>
    </span>
  )
}
