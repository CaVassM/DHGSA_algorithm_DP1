import { useState, useMemo } from 'react'
import { SEMAFORO_COLORES, getSemaforoPorOcupacion } from '../data/aeropuertos'

// Panel de control de la operación día a día — MISMA estructura y
// funcionalidad que PanelListas (Dashboard de la simulación 5D): tres
// pestañas (Almacenes / UT / Envíos), cada una con su buscador, su orden y
// sus filtros propios. La diferencia es la fuente de datos: aquí no hay
// `runId` ni rutas persistidas, todo sale de la operación en vivo
// (`getEnviosDiariosConRuta` + `getEstadoDiario`) que ya trae el mapa.

const TABS = [
  { id: 'almacenes', label: 'Almacenes' },
  { id: 'vuelos', label: 'Vuelos' },
  { id: 'envios', label: 'Envíos' },
]

const SEM_LABEL = {
  vacio: 'Vacío',
  verde: 'Baja carga',
  ambar: 'Carga media',
  rojo: 'Carga alta',
}

const FASES_ENVIO = [
  { id: 'todos', label: 'Todos' },
  { id: 'en-almacen', label: 'En almacén' },
  { id: 'en-vuelo', label: 'En vuelo' },
  { id: 'en-escala', label: 'En escala' },
  { id: 'entregada', label: 'Entregado' },
]

const ORDEN_ALMACENES = {
  icao: { label: 'Código', cmp: (a, b) => compararTexto(a.codigoIcao, b.codigoIcao) },
  ciudad: { label: 'Ciudad', cmp: (a, b) => compararTexto(a.ciudad, b.ciudad) },
  capacidad: { label: 'Capacidad', cmp: (a, b) => compararNumero(a.capacidadAlmacen, b.capacidadAlmacen) },
  carga: { label: 'Ocupación', cmp: (a, b) => compararNumero(a._pct, b._pct) },
}

const ORDEN_VUELOS = {
  ocupacion: { label: 'Ocupación', cmp: (a, b) => compararNumero(a.ocupacionPorcentaje, b.ocupacionPorcentaje) },
  salida: { label: 'Hora de salida', cmp: (a, b) => compararFecha(a.salidaUtc, b.salidaUtc) },
  llegada: { label: 'Hora de llegada', cmp: (a, b) => compararFecha(a.llegadaUtc, b.llegadaUtc) },
  origen: { label: 'Origen', cmp: (a, b) => compararTexto(a.origenIcao, b.origenIcao) },
  destino: { label: 'Destino', cmp: (a, b) => compararTexto(a.destinoIcao, b.destinoIcao) },
}

const ORDEN_ENVIOS = {
  deadline: { label: 'Plazo', cmp: (a, b) => compararTexto(a.deadlineLocalDestino, b.deadlineLocalDestino) },
  maletas: { label: 'Maletas', cmp: (a, b) => compararNumero(a.cantidadMaletas, b.cantidadMaletas) },
  id: { label: 'ID', cmp: (a, b) => compararTexto(a.envioId, b.envioId) },
  origen: { label: 'Origen', cmp: (a, b) => compararTexto(a.origenIcao, b.origenIcao) },
}

function compararTexto(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'es', { numeric: true, sensitivity: 'base' })
}

function compararNumero(a, b) {
  return Number(a ?? 0) - Number(b ?? 0)
}

function compararFecha(a, b) {
  const ta = a ? new Date(a).getTime() : Number.MAX_SAFE_INTEGER
  const tb = b ? new Date(b).getTime() : Number.MAX_SAFE_INTEGER
  return ta - tb
}

function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function textoUbicacion(codigo, aeropuerto) {
  return normalizarTexto([codigo, aeropuerto?.codigoIcao, aeropuerto?.ciudad, aeropuerto?.pais]
    .filter(Boolean).join(' '))
}

function plantillaDe(vueloId) {
  return String(vueloId ?? '').split('@')[0]
}

function hhmm(iso) {
  return iso ? String(iso).slice(11, 16) : '—'
}

/** "20:07 GMT+5 (UTC 15:07)" — la hora local seguida de su equivalente UTC,
 * para no tener que convertir a mano en ningún panel. */
function horaConUtc(local, gmt, utc) {
  return `${hhmm(local)} ${gmt ?? ''} (UTC ${hhmm(utc)})`
}

const ESTADO_VUELO = {
  'en-vuelo': { label: 'En vuelo', color: 'text-blue-400', icono: '✈' },
  'por-salir': { label: 'Por salir', color: 'text-slate-400', icono: null },
  'llego': { label: 'Llegó', color: 'text-slate-500', icono: null },
  'cancelado': { label: 'Cancelado', color: 'text-red-400', icono: '✕' },
}

export default function PanelListasDiaADia({
  aeropuertos = [],
  envios = [],
  estadosPorEnvio,
  estado,
  ahoraUtc,
  seleccionado,
  onSelectShipment,
  vueloResaltado,
  onSelectFlight,
  almacenSeleccionado,
  onSelectAlmacen,
  onCancelarVuelo,
  cancelando,
  avisoCancelacion,
}) {
  const [tab, setTab] = useState('envios')
  const [busqueda, setBusqueda] = useState('')
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(true)
  const [orden, setOrden] = useState({ almacenes: 'icao', vuelos: 'ocupacion', envios: 'deadline' })
  const [direccion, setDireccion] = useState({ almacenes: 'asc', vuelos: 'desc', envios: 'asc' })

  const [busquedaOrigen, setBusquedaOrigen] = useState('')
  const [busquedaDestino, setBusquedaDestino] = useState('')
  const [filtroOrigen, setFiltroOrigen] = useState('Todos')
  const [filtroDestino, setFiltroDestino] = useState('Todos')
  const [fase, setFase] = useState('todos')

  const [almacenAbierto, setAlmacenAbierto] = useState(null)
  const [vueloAbierto, setVueloAbierto] = useState(null)

  const airportMap = useMemo(
    () => new Map(aeropuertos.map(a => [a.codigoIcao, a])),
    [aeropuertos],
  )
  const capacidadPorIcao = useMemo(
    () => new Map((estado?.almacenes ?? []).map(a => [a.icao, a])),
    [estado],
  )

  // Dónde está sentada cada maleta AHORA MISMO (en almacén de origen, o en
  // escala): es lo único que ocupa espacio físico en una sede en día a día
  // (volando no ocupa almacén). Alimenta la ocupación y el detalle
  // entran/salen de la pestaña Almacenes.
  const porAlmacen = useMemo(() => {
    const resultado = {}
    const asegurar = icao => (resultado[icao] ??= { ocupacion: 0, entran: [], salen: [] })
    envios.forEach(envio => {
      const est = estadosPorEnvio?.get(envio.envioId)
      if (!est) return
      if (est.fase === 'en-almacen') {
        const icao = envio.tramos?.[0]?.origenIcao
        if (!icao) return
        const b = asegurar(icao)
        b.ocupacion += envio.cantidadMaletas ?? 0
        b.salen.push(envio)
      } else if (est.fase === 'en-escala') {
        const icao = envio.tramos?.[est.tramoActual]?.destinoIcao
        if (!icao) return
        const b = asegurar(icao)
        b.ocupacion += envio.cantidadMaletas ?? 0
        b.entran.push(envio)
        b.salen.push(envio)
      }
    })
    return resultado
  }, [envios, estadosPorEnvio])

  // Quién viaja en cada vuelo FÍSICO ahora mismo (para el detalle "Ver
  // envíos" de la pestaña Vuelos). Se arma sobre TODOS los tramos de TODOS
  // los envíos, no solo los que están volando: un vuelo puede llevar carga
  // todavía en tierra (aún no despegó) y eso también hay que poder verlo.
  const enviosPorVuelo = useMemo(() => {
    const resultado = new Map()
    envios.forEach(envio => {
      envio.tramos?.forEach(t => {
        const lista = resultado.get(t.vueloId) ?? []
        lista.push(envio)
        resultado.set(t.vueloId, lista)
      })
    })
    return resultado
  }, [envios])

  const origenes = useMemo(
    () => [...new Set((estado?.vuelos ?? []).map(v => v.origenIcao).filter(Boolean))].sort(compararTexto),
    [estado],
  )
  const destinos = useMemo(
    () => [...new Set((estado?.vuelos ?? []).map(v => v.destinoIcao).filter(Boolean))].sort(compararTexto),
    [estado],
  )

  const q = normalizarTexto(busqueda)

  const almacenesView = useMemo(() => {
    const preparados = aeropuertos.map(a => {
      const flujo = porAlmacen[a.codigoIcao] ?? { ocupacion: 0, entran: [], salen: [] }
      const capacidad = Number(a.capacidadAlmacen ?? 0)
      const pct = capacidad > 0 ? Math.round((flujo.ocupacion / capacidad) * 1000) / 10 : 0
      return {
        ...a,
        _actual: flujo.ocupacion,
        _entran: flujo.entran,
        _salen: flujo.salen,
        _pct: pct,
        _sem: getSemaforoPorOcupacion(pct),
        _preparado: capacidadPorIcao.get(a.codigoIcao)?.preparado ?? false,
      }
    })
    const filtrados = q ? preparados.filter(a => textoUbicacion(a.codigoIcao, a).includes(q)) : preparados
    const mult = direccion.almacenes === 'asc' ? 1 : -1
    return [...filtrados].sort((a, b) => mult * ORDEN_ALMACENES[orden.almacenes].cmp(a, b))
  }, [aeropuertos, porAlmacen, capacidadPorIcao, q, orden.almacenes, direccion.almacenes])

  const vuelosView = useMemo(() => {
    const bOrigen = normalizarTexto(busquedaOrigen)
    const bDestino = normalizarTexto(busquedaDestino)
    // "Ahora" en la MISMA convención que usa el mapa (ahoraUtc, no new Date()
    // directo): las horas del backend llegan sin zona y el navegador las lee
    // como locales, así que comparar contra un new Date() normal desalinea
    // esto por el huso del equipo — el mismo bug que ya se corrigió en el mapa.
    const ahora = ahoraUtc ?? new Date()
    const preparados = (estado?.vuelos ?? []).map(v => {
      const plantilla = plantillaDe(v.vueloId)
      const origenInfo = airportMap.get(v.origenIcao)
      const destinoInfo = airportMap.get(v.destinoIcao)
      const salida = v.salidaUtc ? new Date(v.salidaUtc) : null
      const llegada = v.llegadaUtc ? new Date(v.llegadaUtc) : null
      const yaSalio = salida && ahora >= salida
      const yaLlego = llegada && ahora >= llegada
      const estadoVuelo = v.cancelado ? 'cancelado' : (yaSalio && !yaLlego) ? 'en-vuelo' : yaLlego ? 'llego' : 'por-salir'
      return {
        ...v,
        _plantilla: plantilla,
        _origenTexto: textoUbicacion(v.origenIcao, origenInfo),
        _destinoTexto: textoUbicacion(v.destinoIcao, destinoInfo),
        _origenDetalle: [origenInfo?.ciudad, origenInfo?.pais].filter(Boolean).join(' · '),
        _destinoDetalle: [destinoInfo?.ciudad, destinoInfo?.pais].filter(Boolean).join(' · '),
        _estadoVuelo: estadoVuelo,
      }
    })
    const filtrados = preparados.filter(v => {
      const coincideGeneral = !q || [v.vueloId, v._origenTexto, v._destinoTexto]
        .some(x => normalizarTexto(x).includes(q))
      const coincideOrigen = !bOrigen || v._origenTexto.includes(bOrigen)
      const coincideDestino = !bDestino || v._destinoTexto.includes(bDestino)
      const coincideFiltroOrigen = filtroOrigen === 'Todos' || v.origenIcao === filtroOrigen
      const coincideFiltroDestino = filtroDestino === 'Todos' || v.destinoIcao === filtroDestino
      return coincideGeneral && coincideOrigen && coincideDestino
        && coincideFiltroOrigen && coincideFiltroDestino
    })
    const mult = direccion.vuelos === 'asc' ? 1 : -1
    return [...filtrados].sort((a, b) =>
      Number(b._plantilla === vueloResaltado) - Number(a._plantilla === vueloResaltado)
      // Los que ya están en vuelo primero: es justo lo que se quiere ubicar
      // de un vistazo en esta pestaña.
      || Number(b._estadoVuelo === 'en-vuelo') - Number(a._estadoVuelo === 'en-vuelo')
      || mult * ORDEN_VUELOS[orden.vuelos].cmp(a, b)
      || compararTexto(a.vueloId, b.vueloId))
  }, [
    estado, airportMap, q, busquedaOrigen, busquedaDestino, filtroOrigen, filtroDestino,
    orden.vuelos, direccion.vuelos, vueloResaltado, ahoraUtc,
  ])

  const enviosView = useMemo(() => {
    const filtrados = envios.filter(envio => {
      const est = estadosPorEnvio?.get(envio.envioId)
      const coincideFase = fase === 'todos' || est?.fase === fase
      if (!coincideFase) return false
      if (!q) return true
      return [envio.envioId, envio.origenIcao, envio.destinoIcao, envio.idCliente]
        .some(x => normalizarTexto(x).includes(q))
    })
    const mult = direccion.envios === 'asc' ? 1 : -1
    return [...filtrados].sort((a, b) => mult * ORDEN_ENVIOS[orden.envios].cmp(a, b))
  }, [envios, estadosPorEnvio, fase, q, orden.envios, direccion.envios])

  const ordenActual = { almacenes: ORDEN_ALMACENES, vuelos: ORDEN_VUELOS, envios: ORDEN_ENVIOS }[tab]
  const conteo = { almacenes: almacenesView.length, vuelos: vuelosView.length, envios: enviosView.length }[tab]

  function cambiarTab(id) {
    setTab(id)
    setBusqueda('')
    setAlmacenAbierto(null)
    setVueloAbierto(null)
  }

  function seleccionarVuelo(plantilla) {
    const nueva = vueloResaltado === plantilla ? null : plantilla
    onSelectFlight?.(nueva)
    if (nueva) { onSelectShipment?.(null); onSelectAlmacen?.(null) }
  }

  function seleccionarEnvio(envioId) {
    const nuevo = seleccionado === envioId ? null : envioId
    onSelectShipment?.(nuevo)
    if (nuevo) { onSelectFlight?.(null); onSelectAlmacen?.(null) }
  }

  function seleccionarAlmacen(codigoIcao) {
    const abrir = almacenAbierto !== codigoIcao
    setAlmacenAbierto(abrir ? codigoIcao : null)
    onSelectAlmacen?.(abrir ? codigoIcao : null)
    if (abrir) { onSelectShipment?.(null); onSelectFlight?.(null) }
  }

  function limpiarFiltrosVuelos() {
    setBusqueda('')
    setBusquedaOrigen('')
    setBusquedaDestino('')
    setFiltroOrigen('Todos')
    setFiltroDestino('Todos')
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex bg-slate-900 border-b border-slate-700 sticky top-0 z-10">
        {TABS.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => cambiarTab(item.id)}
            className={`flex-1 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              tab === item.id
                ? 'text-blue-300 border-b-2 border-blue-500 bg-slate-800/50'
                : 'text-slate-500 hover:text-slate-300'}`}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setFiltrosAbiertos(a => !a)}
          title={filtrosAbiertos ? 'Ocultar filtros' : 'Mostrar filtros'}
          className="px-2.5 text-slate-500 hover:text-slate-200 text-xs border-l border-slate-700"
        >
          {filtrosAbiertos ? '▴' : '▾'}
        </button>
      </div>

      {filtrosAbiertos && (
        tab === 'vuelos' ? (
          <div className="px-2 py-2 space-y-1.5 bg-slate-900/60 border-b border-slate-800">
            <input
              value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar vuelo por código o ubicación"
              className="w-full bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1.5 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <div className="grid grid-cols-2 gap-1.5">
              <input
                value={busquedaOrigen} onChange={e => setBusquedaOrigen(e.target.value)}
                placeholder="Buscar en origen"
                className="min-w-0 bg-slate-800 border border-slate-600 text-slate-200 text-[11px] rounded px-2 py-1.5 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <input
                value={busquedaDestino} onChange={e => setBusquedaDestino(e.target.value)}
                placeholder="Buscar en destino"
                className="min-w-0 bg-slate-800 border border-slate-600 text-slate-200 text-[11px] rounded px-2 py-1.5 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <select
                value={filtroOrigen} onChange={e => setFiltroOrigen(e.target.value)}
                className="min-w-0 bg-slate-800 border border-slate-600 text-slate-300 text-[11px] rounded px-1.5 py-1.5 focus:outline-none focus:border-blue-500"
              >
                <option value="Todos">Origen: todos</option>
                {origenes.map(icao => <option key={icao} value={icao}>{icao}</option>)}
              </select>
              <select
                value={filtroDestino} onChange={e => setFiltroDestino(e.target.value)}
                className="min-w-0 bg-slate-800 border border-slate-600 text-slate-300 text-[11px] rounded px-1.5 py-1.5 focus:outline-none focus:border-blue-500"
              >
                <option value="Todos">Destino: todos</option>
                {destinos.map(icao => <option key={icao} value={icao}>{icao}</option>)}
              </select>
            </div>
            <div className="flex gap-1.5">
              <select
                value={orden.vuelos} onChange={e => setOrden(a => ({ ...a, vuelos: e.target.value }))}
                className="flex-1 min-w-0 bg-slate-800 border border-slate-600 text-slate-300 text-[11px] rounded px-1.5 py-1.5 focus:outline-none focus:border-blue-500"
              >
                {Object.entries(ORDEN_VUELOS).map(([k, c]) => <option key={k} value={k}>Ordenar: {c.label}</option>)}
              </select>
              <button
                type="button"
                onClick={() => setDireccion(a => ({ ...a, vuelos: a.vuelos === 'asc' ? 'desc' : 'asc' }))}
                className="w-9 rounded border border-slate-600 bg-slate-800 text-slate-300 hover:text-white"
              >
                {direccion.vuelos === 'asc' ? '▲' : '▼'}
              </button>
              <button
                type="button" onClick={limpiarFiltrosVuelos}
                className="px-2 rounded border border-slate-600 bg-slate-800 text-[10px] text-slate-400 hover:text-white"
              >
                Limpiar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2 py-2 bg-slate-900/60">
            <input
              value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar…"
              className="flex-1 min-w-0 bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1.5 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <select
              value={orden[tab]} onChange={e => setOrden(a => ({ ...a, [tab]: e.target.value }))}
              className="shrink-0 bg-slate-800 border border-slate-600 text-slate-300 text-xs rounded px-1.5 py-1.5 focus:outline-none focus:border-blue-500 max-w-[7.5rem]"
            >
              {Object.entries(ordenActual).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setDireccion(a => ({ ...a, [tab]: a[tab] === 'asc' ? 'desc' : 'asc' }))}
              className="w-8 rounded border border-slate-600 bg-slate-800 text-slate-300"
            >
              {direccion[tab] === 'asc' ? '▲' : '▼'}
            </button>
          </div>
        )
      )}

      {filtrosAbiertos && tab === 'envios' && (
        <div className="grid grid-cols-5 gap-1 px-2 pb-2 bg-slate-900/60">
          {FASES_ENVIO.map(f => (
            <button
              key={f.id} type="button" onClick={() => setFase(f.id)}
              className={`rounded px-1 py-1.5 text-[9px] ${
                fase === f.id ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <div className="px-2 py-1 text-[10px] text-slate-500 bg-slate-900/60">
        {conteo} resultado{conteo === 1 ? '' : 's'}
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-800">
        {conteo === 0 ? (
          <p className="px-3 py-6 text-xs text-slate-500 text-center">Sin resultados.</p>
        ) : tab === 'almacenes' ? (
          almacenesView.map(a => {
            const abierto = almacenAbierto === a.codigoIcao
            const enfocado = almacenSeleccionado === a.codigoIcao
            return (
              <div key={a.codigoIcao} className={enfocado ? 'border-l-2 border-pink-400' : ''}>
                <button
                  type="button"
                  onClick={() => seleccionarAlmacen(a.codigoIcao)}
                  className={`w-full text-left px-3 py-2 transition-colors ${
                    abierto ? 'bg-slate-800/80' : 'hover:bg-slate-800/60'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm text-blue-300">{a.codigoIcao}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: SEMAFORO_COLORES[a._sem] }} />
                      <span className="text-[10px] text-slate-400">{SEM_LABEL[a._sem]} {a._pct.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-slate-400 truncate">{a.ciudad} · {a.pais}</span>
                    <span className="text-[11px] text-slate-500 font-mono shrink-0">
                      {a._actual.toLocaleString()}/{Number(a.capacidadAlmacen ?? 0).toLocaleString()}
                      {a._preparado && <span className="text-green-400 ml-1">✓</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <span className="text-[10px]">
                      <span className="text-green-400">↓ {a._entran.length} entran</span>
                      <span className="text-slate-600"> · </span>
                      <span className="text-amber-400">↑ {a._salen.length} salen</span>
                    </span>
                    <span className={`text-[10px] ${enfocado ? 'text-pink-300' : 'text-slate-500'}`}>
                      {abierto ? '▲ cerrar (enfocado en mapa)' : '▼ ver envíos y enfocar en mapa'}
                    </span>
                  </div>
                </button>
                {abierto && (
                  <div className="bg-slate-900/70 border-t border-slate-800 px-3 py-2 space-y-2">
                    <ListaFlujo titulo="Entran (en escala)" color="text-green-400" envios={a._entran}
                      seleccionado={seleccionado} onSelectShipment={seleccionarEnvio} />
                    <ListaFlujo titulo="Salen (en almacén / en escala)" color="text-amber-400" envios={a._salen}
                      seleccionado={seleccionado} onSelectShipment={seleccionarEnvio} />
                  </div>
                )}
              </div>
            )
          })
        ) : tab === 'vuelos' ? (
          vuelosView.map(v => {
            const abierto = vueloAbierto === v.vueloId
            const resaltado = vueloResaltado === v._plantilla
            const enviosVuelo = enviosPorVuelo.get(v.vueloId) ?? []
            const pct = v.ocupacionPorcentaje ?? 0
            const sem = getSemaforoPorOcupacion(pct)
            const est = ESTADO_VUELO[v._estadoVuelo]
            return (
              <div key={v.vueloId} className={`${abierto ? 'bg-slate-800/35' : ''} ${resaltado ? 'border-l-2 border-amber-400' : ''}`}>
                <button
                  type="button"
                  onClick={() => seleccionarVuelo(v._plantilla)}
                  className="w-full px-3 pt-2 pb-1.5 text-left hover:bg-slate-800/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {est.icono && <span className={est.color} title={est.label}>{est.icono}</span>}
                        <span className="font-mono text-xs font-semibold text-blue-300 truncate">{v._plantilla}</span>
                        <span className={`text-[10px] font-semibold ${est.color}`}>{est.label}</span>
                      </div>
                      <div className="text-xs text-slate-200 mt-0.5">{v.origenIcao} → {v.destinoIcao}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {v._origenDetalle || v.origenIcao} → {v._destinoDetalle || v.destinoIcao}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Sale: {horaConUtc(v.salidaLocal, v.gmtOrigen, v.salidaUtc)}
                      </div>
                    </div>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: SEMAFORO_COLORES[sem] }} />
                      <span className="text-[10px] text-slate-400">{pct.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500">
                    <span>Ocupado: {v.ocupado}/{v.capacidad}</span>
                    <span>Llega: {horaConUtc(v.llegadaLocal, v.gmtDestino, v.llegadaUtc)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[10px]">
                    <span className="text-blue-300">{enviosVuelo.length} envío{enviosVuelo.length === 1 ? '' : 's'}</span>
                    <span className={resaltado ? 'text-amber-300' : 'text-slate-500'}>
                      {resaltado ? 'Resaltado en mapa' : 'Resaltar en mapa'}
                    </span>
                  </div>
                </button>

                <div className="px-3 pb-2 grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setVueloAbierto(abierto ? null : v.vueloId)}
                    className={`rounded border px-2 py-1 text-[10px] transition-colors ${
                      abierto ? 'border-blue-400 bg-blue-500/15 text-blue-200'
                        : 'border-slate-600 text-slate-400 hover:text-blue-300 hover:border-blue-500/60'}`}
                  >
                    {abierto ? 'Ocultar envíos' : `Ver envíos (${enviosVuelo.length})`}
                  </button>
                  {!v.cancelado && (
                    <button
                      type="button"
                      onClick={() => onCancelarVuelo?.(v.vueloId)}
                      disabled={cancelando === v._plantilla}
                      className="rounded border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 text-red-300 text-[10px] font-medium transition-colors"
                    >
                      {cancelando === v._plantilla ? 'Cancelando…' : '✕ Cancelar'}
                    </button>
                  )}
                </div>
                {avisoCancelacion && cancelando == null && v._plantilla === avisoCancelacion.plantilla && (
                  <p className={`px-3 pb-2 text-[10px] leading-snug ${
                    avisoCancelacion.ok ? 'text-red-300' : 'text-amber-300'}`}>
                    {avisoCancelacion.texto}
                  </p>
                )}

                {abierto && (
                  <div className="border-t border-slate-700 bg-slate-950/45 px-3 py-2">
                    {enviosVuelo.length === 0 ? (
                      <p className="text-[11px] text-slate-500">Sin envíos asignados a este vuelo.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {enviosVuelo.map(envio => (
                          <button
                            key={envio.envioId} type="button"
                            onClick={() => seleccionarEnvio(envio.envioId)}
                            className={`w-full rounded border px-2 py-1.5 text-left transition-colors ${
                              seleccionado === envio.envioId
                                ? 'border-amber-400 bg-amber-500/15'
                                : 'border-slate-800 bg-slate-900/60 hover:border-blue-500/50'}`}
                          >
                            <div className="flex justify-between gap-2">
                              <span className="font-mono text-[11px] text-blue-300">{envio.envioId}</span>
                              <span className="font-mono text-[10px] text-slate-400">{envio.cantidadMaletas} mal.</span>
                            </div>
                            <div className="mt-0.5 flex justify-between gap-2 text-[10px] text-slate-500">
                              <span>{envio.origenIcao} → {envio.destinoIcao}</span>
                              <span>{envio.directa ? 'Directo' : `${envio.escalas} escala(s)`}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        ) : (
          enviosView.map(envio => {
            const est = estadosPorEnvio?.get(envio.envioId)
            const activo = seleccionado === envio.envioId
            return (
              <button
                key={envio.envioId} type="button"
                onClick={() => seleccionarEnvio(envio.envioId)}
                className={`w-full text-left px-3 py-2 transition-colors ${
                  activo ? 'bg-blue-600/20 border-l-2 border-l-blue-500' : 'hover:bg-slate-800/60'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-medium ${activo ? 'text-blue-300' : 'text-slate-100'}`}>
                    {envio.origenIcao} → {envio.destinoIcao}
                  </span>
                  <span className="text-xs font-mono text-slate-500">{envio.envioId}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="text-xs text-slate-400">
                    {envio.cantidadMaletas} maletas
                    {envio.idCliente && <span className="text-slate-500"> · {envio.idCliente}</span>}
                  </span>
                  <span className="text-xs text-slate-500">
                    {envio.directa ? 'directa' : `${envio.escalas} escala(s)`}
                  </span>
                </div>
                {est && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: est.color }} />
                    <span className="text-xs font-medium" style={{ color: est.color }}>{est.etiqueta}</span>
                    {est.detalle && <span className="text-xs text-slate-500 truncate">· {est.detalle}</span>}
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

function ListaFlujo({ titulo, color, envios, seleccionado, onSelectShipment }) {
  return (
    <div>
      <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${color}`}>
        {titulo} ({envios.length})
      </div>
      {envios.length === 0 ? (
        <p className="text-[11px] text-slate-500 pb-1">Ninguno.</p>
      ) : (
        <ul className="space-y-1 max-h-36 overflow-y-auto">
          {envios.map(envio => (
            <li key={envio.envioId}>
              <button
                type="button"
                onClick={() => onSelectShipment?.(envio.envioId)}
                className={`w-full text-left rounded px-2 py-1 transition-colors ${
                  seleccionado === envio.envioId
                    ? 'bg-amber-500/20 border-l-2 border-amber-400'
                    : 'bg-slate-800/60 hover:bg-slate-700/60'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-blue-300 truncate">{envio.envioId}</span>
                  <span className="font-mono text-[11px] text-slate-300 shrink-0">{envio.cantidadMaletas} mal.</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400 mt-0.5">
                  <span>{envio.origenIcao} → {envio.destinoIcao}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}