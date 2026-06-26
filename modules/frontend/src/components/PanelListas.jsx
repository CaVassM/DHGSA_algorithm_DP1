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
  icao:      { label: 'Código (A-Z)',      cmp: byStr('codigoIcao') },
  ciudad:    { label: 'Ciudad (A-Z)',      cmp: byStr('ciudad') },
  capacidad: { label: 'Capacidad (↑)',     cmp: byNum('capacidadAlmacen') },
  carga:     { label: 'Carga (↓)',         cmp: (a, b) => (b._pct - a._pct) },
}

const ORDEN_VUELOS = {
  salida:    { label: 'Hora salida (↑)',   cmp: byStr('horaSalida') },
  origen:    { label: 'Origen (A-Z)',      cmp: byStr('origenIcao') },
  destino:   { label: 'Destino (A-Z)',     cmp: byStr('destinoIcao') },
  ocupacion: { label: 'Ocupación (↓)',     cmp: (a, b) => (b._pct - a._pct) },
}

const ORDEN_ENVIOS = {
  deadline:  { label: 'Deadline (↑)',      cmp: byStr('deadline') },
  maletas:   { label: 'Maletas (↓)',       cmp: (a, b) => byNum('cantidadMaletas')(b, a) },
  prioridad: { label: 'Prioridad (↓)',     cmp: (a, b) => byNum('prioridad')(b, a) },
  id:        { label: 'ID (A-Z)',          cmp: byStr('businessId') },
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

export default function PanelListas({ ocupacionPorIcao = {}, airportFromMap, onSelectAirport, onSelectShipment }) {
  const [tab, setTab] = useState('almacenes')
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState({ almacenes: 'icao', vuelos: 'salida', envios: 'deadline' })

  const [airports, setAirports] = useState([])
  const [flights, setFlights] = useState([])
  const [shipments, setShipments] = useState([])
  const [cargando, setCargando] = useState(true)

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

  const q = busqueda.trim().toLowerCase()

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
    return [...filtrado].sort(ORDEN_ALMACENES[orden.almacenes].cmp)
  }, [airports, ocupacionPorIcao, q, orden.almacenes])

  const vuelosView = useMemo(() => {
    const conPct = flights.map(f => ({ ...f, _pct: flightPct(f), _sem: getSemaforoPorOcupacion(flightPct(f)) }))
    const filtrado = q
      ? conPct.filter(f =>
          f.businessId?.toLowerCase().includes(q) ||
          f.origenIcao?.toLowerCase().includes(q) ||
          f.destinoIcao?.toLowerCase().includes(q))
      : conPct
    return [...filtrado].sort(ORDEN_VUELOS[orden.vuelos].cmp)
  }, [flights, q, orden.vuelos])

  const enviosView = useMemo(() => {
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
  }, [shipments, q, orden.envios])

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
      </div>

      <div className="px-2 pb-1 text-[10px] text-slate-500">{conteo} resultado{conteo === 1 ? '' : 's'}</div>

      {/* Lista scrolleable */}
      <div className="max-h-72 overflow-y-auto divide-y divide-slate-800">
        {cargando ? (
          <p className="px-3 py-6 text-xs text-slate-500 text-center">Cargando…</p>
        ) : conteo === 0 ? (
          <p className="px-3 py-6 text-xs text-slate-500 text-center">Sin resultados.</p>
        ) : tab === 'almacenes' ? (
          almacenesView.map(ap => (
            <button
              key={ap.codigoIcao}
              onClick={() => onSelectAirport?.(ap.codigoIcao)}
              className="w-full text-left px-3 py-2 hover:bg-slate-800/60 transition-colors"
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
            </button>
          ))
        ) : tab === 'vuelos' ? (
          vuelosView.map(f => (
            <div key={f.businessId} className="px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-200">{f.origenIcao} → {f.destinoIcao}</span>
                <SemChip sem={f._sem} pct={f._pct} />
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="font-mono text-[11px] text-slate-500 truncate">{f.businessId}</span>
                <span className="text-[11px] text-slate-500 font-mono shrink-0">
                  {f.horaSalida?.slice(0, 5)}–{f.horaLlegada?.slice(0, 5)} · cap {f.capacidad}
                </span>
              </div>
            </div>
          ))
        ) : (
          enviosView.map(s => (
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
          ))
        )}
      </div>
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
