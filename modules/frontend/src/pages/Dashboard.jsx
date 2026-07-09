import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import NavBar from '../components/NavBar'
import PanelLateral from '../components/PanelLateral'
import MapaMundi from '../components/MapaMundi'
import EnviosEnVuelo from '../components/EnviosEnVuelo'
import IndicadoresGlobalesBar from '../components/IndicadoresGlobalesBar'
import { getPlanningRun, getLatestRun } from '../services/api'
import { suscribirSimulacion } from '../services/simulacionSocket'

const TERMINAL_STATUSES = new Set(['COMPLETED', 'COMPLETED_WITH_PENDING_SHIPMENTS', 'FAILED'])

const LS_KEY = 'tasf_runId'

export default function Dashboard() {
  const location = useLocation()
  const stored   = localStorage.getItem(LS_KEY)
  // runId es estado para poder caer al último run terminado cuando no llega por
  // navegación ni hay uno guardado válido (p.ej. se entra directo al mapa, o el
  // runId guardado quedó obsoleto porque ese run se borró). Sin esto el mapa se
  // queda sin reproductor ni rutas que animar.
  const [runId, setRunId] = useState(
    location.state?.runId ?? (stored ? Number(stored) : null)
  )
  const [run, setRun] = useState(null)
  const [enVuelo, setEnVuelo] = useState([]) // T41: envíos actualmente en tránsito
  const [ocupacion, setOcupacion] = useState({}) // maletas por aeropuerto (del mapa)
  // Vinculación panel→mapa: selección de aeropuerto / envío desde las listas.
  // El nonce fuerza la reacción aunque se reseleccione el mismo elemento.
  const [focusAirport, setFocusAirport] = useState(null)
  const [highlightShipment, setHighlightShipment] = useState(null)
  // Vinculación mapa→panel: aeropuerto elegido con click en el mapa.
  const [airportFromMap, setAirportFromMap] = useState(null)
  const intervalRef = useRef(null)
  //agregado esta seccion para la simulacion en vivo 
  const [eventoSimulacion, setEventoSimulacion] = useState(null)
  const [rutasEnVivo, setRutasEnVivo] = useState([])
  const [routesRefreshKey, setRoutesRefreshKey] = useState(0)
  const [simulacionEnVivo, setSimulacionEnVivo] = useState(
    location.state?.live ?? false
  )
  // Ritmo de la simulación en vivo: el mapa deriva de aquí la velocidad de
  // reproducción para que cada época dure lo mismo que tarda el backend en
  // mandar la siguiente. Vienen de la pantalla de configuración por navegación.
  const multiplicador = location.state?.multiplicador ?? 240
  const epochHours = location.state?.epochHours ?? 4
  // Re-navegación a /dashboard con un runId nuevo (p.ej. arrancar una SEGUNDA
  // simulación en vivo): el componente puede seguir montado, así que el useState
  // inicial NO se re-evalúa. Sin esto, la segunda simulación no tomaba el nuevo
  // runId y el mapa se quedaba con la corrida anterior (no animaba). Sincronizamos
  // runId y el flag de "en vivo" cada vez que cambia el state de navegación.
  const navRunId = location.state?.runId
  const navLive = location.state?.live
  useEffect(() => {
    if (navRunId == null) return
    setRunId(navRunId)
    setSimulacionEnVivo(navLive ?? false)
    // Nueva corrida: limpiar el último evento para no arrastrar el de la anterior.
    setEventoSimulacion(null)
  }, [navRunId, navLive])

  // Persistir el runId para que sobreviva recargas y navegación entre páginas
  useEffect(() => {
    if (runId != null) localStorage.setItem(LS_KEY, String(runId))
  }, [runId])

  // Fallback: si no hay runId (entrada directa al mapa, o storage vacío),
  // cargar el último run terminado para tener algo que animar.
  useEffect(() => {
    if (runId != null) return
    let vivo = true
    getLatestRun()
      .then(latest => { if (vivo && latest?.id != null) setRunId(latest.id) })
      .catch(() => {})
    return () => { vivo = false }
  }, [runId])

  useEffect(() => {
    if (!runId) return

    async function poll() {
      try {
        const data = await getPlanningRun(runId)
        setRun(data)
        if (TERMINAL_STATUSES.has(data.status)) {
          clearInterval(intervalRef.current)
        }
      } catch (err) {
        // Si el run guardado ya no existe (404, p.ej. se borró), descartarlo y
        // limpiar el storage para que el fallback cargue el último run.
        if (err?.response?.status === 404) {
          clearInterval(intervalRef.current)
          localStorage.removeItem(LS_KEY)
          setRunId(null)
        }
        // Otros errores (red transitoria): mantener el polling.
      }
    }

    poll()
    intervalRef.current = setInterval(poll, 3000)
    return () => clearInterval(intervalRef.current)
  }, [runId])

  // T62: además del polling (respaldo), suscribirse por WebSocket al estado del
  // run para recibir actualizaciones en tiempo real (multi-dispositivo).
  useEffect(() => {
    if (!runId) return
    const disconnect = suscribirSimulacion(`/topic/run/${runId}`, (data) => {
      if (data && data.id === runId) setRun(data)
    })
    return disconnect
  }, [runId])

  //

  useEffect(() => {
  if (!runId) return

    const topic = location.state?.topic ?? `/topic/simulacion/${runId}`
    
    console.log('Suscribiendo dashboard a:', topic)
    const disconnect = suscribirSimulacion(topic, (ev) => {
    if (!ev) return

    console.log('Evento simulacion dashboard:', ev)

    if (ev.tipo === 'INICIO') {
      setSimulacionEnVivo(true)
    }

    if (ev.tipo === 'EPOCA') {
      setSimulacionEnVivo(true)
      setEventoSimulacion(ev)
      //setRutasEnVivo(ev.rutas ?? [])
      //setRutasEnVivo(prev => [...prev, ...(ev.rutas ?? [])])
      setTimeout(() => {
        setRoutesRefreshKey(v => v + 1)
      }, 500)
      if (ev.ocupacionAlmacenes) {
        setOcupacion(ev.ocupacionAlmacenes)
      }
    }

    if (ev.tipo === 'FIN') {
      setSimulacionEnVivo(false)
      setEventoSimulacion(ev)
    }

    if (ev.tipo === 'ERROR') {
      setSimulacionEnVivo(false)
      console.error(ev.mensaje)
    }
  })

  return disconnect
}, [runId, location.state?.topic])

  return (
    <div className="h-screen flex flex-col bg-[#0f172a] overflow-hidden">
      <NavBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Mapa */}
        <main className="flex-1 relative overflow-hidden p-1">
          {/* <MapaMundi
            runId={runId}
            runCompleted={!!(run && TERMINAL_STATUSES.has(run.status))}
            onActiveLegsChange={setEnVuelo}
            onOcupacionChange={setOcupacion}
            focusAirport={focusAirport}
            highlightShipment={highlightShipment}
            onSelectAirportFromMap={(icao) => setAirportFromMap({ icao, nonce: Date.now() })}
          /> */}
          {/* Cartel de época: reubicado DEBAJO del reloj del mapa (que vive en
              top-3 left-3) para no taparlo. Ya no repetimos el reloj simulado
              aquí — ese dato lo da la tarjeta de tiempos del mapa; este cartel
              solo aporta lo que el mapa no muestra: nº de época y asignados. */}
          {eventoSimulacion?.tipo === 'EPOCA' && (
            <div className="absolute top-40 left-3 z-[1000] w-52 bg-slate-900/90 border border-blue-500/40 rounded-xl px-3 py-2 shadow-lg">
              <div className="text-[10px] text-blue-300 uppercase tracking-widest font-semibold">
                Simulación en vivo
              </div>
              <div className="text-white font-semibold text-sm">
                Época {eventoSimulacion.numeroEpoca} / {eventoSimulacion.totalEpocas}
              </div>
              <div className="text-xs text-green-400">
                Asignados: {eventoSimulacion.totalAsignadosAcumulado ?? 0}
              </div>
            </div>
          )}
          <MapaMundi
            runId={runId}
            runCompleted={!!(run && TERMINAL_STATUSES.has(run.status))}
            liveMode={simulacionEnVivo}
            liveEvent={eventoSimulacion}
            multiplicador={multiplicador}
            epochHours={epochHours}
            routesRefreshKey={routesRefreshKey}
            onActiveLegsChange={setEnVuelo}
            onOcupacionChange={setOcupacion}
            focusAirport={focusAirport}
            highlightShipment={highlightShipment}
            onSelectAirportFromMap={(icao) => setAirportFromMap({ icao, nonce: Date.now() })}
          />
          {/* #7: indicadores globales (flota + almacenes) siempre visibles */}
          <IndicadoresGlobalesBar enVuelo={enVuelo} ocupacionPorIcao={ocupacion} run={run} />
          {/* T41: lista de envíos actualmente en vuelo (sobre el mapa) */}
          <EnviosEnVuelo envios={enVuelo} />
          {/* Leyenda */}
          <div className="absolute bottom-4 left-4 z-[1000] flex gap-3 bg-slate-900/80 backdrop-blur rounded-lg px-4 py-2 border border-slate-700 shadow-lg">
            <LeyendaItem color="bg-slate-400" label="Vacío (0 maletas)" />
            <LeyendaItem color="bg-green-500" label="Baja carga (<60%)" />
            <LeyendaItem color="bg-amber-500" label="Carga media (60–85%)" />
            <LeyendaItem color="bg-red-500" label="Carga alta (>85%)" />
            <LeyendaItem color="bg-blue-500" label="Vuelo en tránsito" />
          </div>
        </main>
        <PanelLateral
          run={run}
          ocupacionPorIcao={ocupacion}
          airportFromMap={airportFromMap}
          onSelectAirport={(icao) => setFocusAirport({ icao, nonce: Date.now() })}
          onSelectShipment={(id) => setHighlightShipment({ id, nonce: Date.now() })}
        />
      </div>
    </div>
  )
}

function LeyendaItem({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-3 h-3 rounded-full ${color}`} />
      <span className="text-slate-300 text-xs">{label}</span>
    </div>
  )
}
