import { useState, useEffect, useCallback, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import NavBar from '../components/NavBar'
import { getAirports, getEnviosDiariosConRuta } from '../services/api'

// Mapa de operaciones día a día.
//
// Pantalla SEPARADA de la de registro, como pide el enunciado: aquella es para
// el empleado que solo recepciona maletas, esta es para ver la operación. Aquí
// se elige un envío y se dibujan todas sus rutas de manera gráfica.
//
// No comparte código con MapaMundi (el de la simulación 5D) a propósito: aquel
// vive de eventos por época, reloj simulado y reproductor, nada de lo cual
// existe en la operación real. Lo que se reutiliza es lo que de verdad se
// comparte: Leaflet, las coordenadas de los aeropuertos y el estilo.

const CENTRO = [10, -20]
const ZOOM = 2

/** Aeropuerto normal: círculo pequeño, discreto. */
const iconoAeropuerto = L.divIcon({
  className: 'tasf-daily-airport',
  html: '<div style="width:8px;height:8px;border-radius:50%;background:#475569;border:1px solid #94a3b8;"></div>',
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

const COLOR_ORIGEN = '#22c55e'
const COLOR_ESCALA = '#f59e0b'
const COLOR_DESTINO = '#3b82f6'

function hhmm(iso) {
  return iso ? String(iso).slice(11, 16) : '—'
}

function fechaHora(iso) {
  return iso ? String(iso).slice(5, 16).replace('T', ' ') : '—'
}

export default function MapaDiaADia() {
  const [aeropuertos, setAeropuertos] = useState([])
  const [envios, setEnvios] = useState([])
  const [seleccionado, setSeleccionado] = useState(null)
  const [filtro, setFiltro] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

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

  const envio = envios.find(e => e.envioId === seleccionado) ?? null

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

        {/* Lista de envíos: es el punto de entrada de la prueba — "se selecciona
            un envío y se debe mostrar en el mapa todas las rutas del envío". */}
        <aside className="w-80 shrink-0 bg-slate-900 border-r border-slate-700 flex flex-col">
          <div className="px-4 py-3 border-b border-slate-700">
            <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Envíos registrados
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Selecciona uno para ver su ruta en el mapa.
            </p>
            <input
              type="text" value={filtro} onChange={e => setFiltro(e.target.value)}
              placeholder="Buscar por id, destino o aerolínea…"
              className="mt-2 w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-blue-500"
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
                  return (
                    <li key={e.envioId}>
                      <button
                        onClick={() => setSeleccionado(activo ? null : e.envioId)}
                        className={`w-full text-left px-4 py-2.5 border-b border-slate-800 transition-colors ${
                          activo ? 'bg-blue-600/20 border-l-2 border-l-blue-500' : 'hover:bg-slate-800/60'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm font-medium ${activo ? 'text-blue-300' : 'text-slate-200'}`}>
                            {e.origenIcao} → {e.destinoIcao}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">{e.envioId}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="text-[11px] text-slate-400">
                            {e.cantidadMaletas} maletas
                            {e.idCliente && <span className="text-slate-500"> · {e.idCliente}</span>}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {e.directa ? 'directa' : `${e.escalas} escala(s)`}
                          </span>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="px-4 py-2 border-t border-slate-700 text-[11px] text-slate-500">
            {envios.length} envío{envios.length === 1 ? '' : 's'} en la jornada
          </div>
        </aside>

        {/* Mapa */}
        <main className="flex-1 relative">
          <MapContainer center={CENTRO} zoom={ZOOM} className="w-full h-full" worldCopyJump>
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution="&copy; OpenStreetMap &copy; CARTO"
            />

            {/* Aeropuertos que no participan en la ruta elegida: se dejan como
                referencia geográfica, sin competir por la atención. */}
            {aeropuertos.map(a => (
              icaosEnRuta.has(a.codigoIcao) ? null : (
                <Marker key={a.codigoIcao} position={[a.latitud, a.longitud]} icon={iconoAeropuerto}>
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
              return (
                <Polyline
                  key={`${t.vueloId}-${i}`}
                  positions={[[a.lat, a.lng], [b.lat, b.lng]]}
                  pathOptions={{
                    color: t.cancelado ? '#ef4444' : '#3b82f6',
                    weight: 3,
                    opacity: 0.9,
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

          {/* Ficha del envío elegido: el plan de viaje completo, tramo a tramo,
              con las horas en la hora de cada aeropuerto. */}
          {envio && (
            <div className="absolute top-3 right-3 z-[1000] w-80 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl shadow-xl overflow-hidden">
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

              <div className="px-4 py-3 max-h-64 overflow-y-auto">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
                  Plan de viaje · {envio.directa ? 'vuelo directo' : `${envio.escalas} escala(s)`}
                </div>
                <ol className="space-y-2">
                  {envio.tramos?.map((t, i) => (
                    <li key={`${t.vueloId}-${i}`} className="relative pl-4">
                      <span className={`absolute left-0 top-1.5 w-2 h-2 rounded-full ${
                        t.cancelado ? 'bg-red-500' : 'bg-blue-500'}`} />
                      <div className="text-[11px] text-slate-200 font-medium">
                        {t.origenIcao} → {t.destinoIcao}
                        {t.cancelado && <span className="ml-1 text-red-400">(cancelado)</span>}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500">{t.vueloId}</div>
                      <div className="text-[10px] text-slate-400">
                        {hhmm(t.salidaLocal)} {t.gmtOrigen} → {hhmm(t.llegadaLocal)} {t.gmtDestino}
                      </div>
                      {t.esperaMinutos > 0 && (
                        <div className="text-[10px] text-amber-400/80">
                          espera {t.esperaMinutos} min en {t.origenIcao}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {/* Leyenda */}
          <div className="absolute bottom-4 left-4 z-[1000] flex gap-3 bg-slate-900/85 backdrop-blur rounded-lg px-4 py-2 border border-slate-700 shadow-lg">
            <Leyenda color={COLOR_ORIGEN} label="Origen" />
            <Leyenda color={COLOR_ESCALA} label="Escala" />
            <Leyenda color={COLOR_DESTINO} label="Destino" />
            <Leyenda color="#ef4444" label="Vuelo cancelado" />
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
