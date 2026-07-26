import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import NavBar from '../components/NavBar'
import {
  getAirports,
  registrarEnvioDiario,
  getEstadoDiario,
  reiniciarDiario,
  cerrarOperacionDiaria,
  getReporteCierreDiario,
  cargarArchivoDiario,
  cancelarVueloDiario,
  prepararEscenarioDiario,
  revertirEscenarioDiario,
  generarVuelosPrueba,
} from '../services/api'

// Aeropuerto de esta terminal. El enunciado pide que NO se teclee: "resulta
// redundante/innecesario y hasta riesgoso que el personal de registro de maletas
// registre la ciudad de origen, pues se trata de una computadora que está todo
// el tiempo en dicho aeropuerto". Se elige una vez, queda guardado en el equipo
// y a partir de ahí el operador solo introduce destino, maletas y aerolínea.
const LS_TERMINAL = 'tasf_terminal_icao'

/**
 * Hora de pared de la terminal, en el formato que espera el backend.
 *
 * Se manda la hora del EQUIPO: durante la prueba cada estudiante lo tiene puesto
 * en el huso de su ciudad, y es esa hora la que debe quedar registrada. El
 * servidor solo la usaría como respaldo si no llegara.
 */
function horaLocalDelEquipo() {
  const ahora = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}`
    + `T${p(ahora.getHours())}:${p(ahora.getMinutes())}:${p(ahora.getSeconds())}`
}

/** "GMT-5" a partir del desfase del aeropuerto. */
function etiquetaGmt(gmt) {
  if (gmt == null) return ''
  return `GMT${gmt >= 0 ? '+' : ''}${gmt}`
}

// Operación día a día (escenario REAL_TIME).
// Pantalla independiente del simulador: se registran envíos a mano, uno a uno,
// y las capacidades de los vuelos se van llenando en vivo hasta el colapso.
// No corre el optimizador ni replanifica — solo valida que exista ruta con cupo.

function colorOcupacion(pct) {
  if (pct >= 90) return { txt: 'text-red-400', bar: 'bg-red-500', bg: 'bg-red-500/10 border-red-500/30' }
  if (pct >= 70) return { txt: 'text-amber-400', bar: 'bg-amber-500', bg: 'bg-amber-500/10 border-amber-500/30' }
  return { txt: 'text-green-400', bar: 'bg-green-500', bg: 'bg-green-500/10 border-green-500/30' }
}

export default function OperacionDiaria() {
  const navigate = useNavigate()
  const [aeropuertos, setAeropuertos] = useState([])
  const [estado, setEstado] = useState(null)
  const [cargandoEstado, setCargandoEstado] = useState(true)

  // Aeropuerto de esta terminal: se fija una vez y persiste en el equipo.
  const [terminal, setTerminal] = useState(() => localStorage.getItem(LS_TERMINAL) ?? '')
  const [destino, setDestino] = useState('')
  const [maletas, setMaletas] = useState('')
  const [cliente, setCliente] = useState('')
  const [enviando, setEnviando] = useState(false)

  // Reloj de la terminal, en su huso. Se refresca cada segundo para que durante
  // la prueba se vea que cada equipo está en la hora de su ciudad.
  const [reloj, setReloj] = useState(() => new Date())

  // Carga de archivo (equipos de 4) y cancelación de vuelos.
  const [subiendo, setSubiendo] = useState(false)
  const [resumenCarga, setResumenCarga] = useState(null)
  const [vueloACancelar, setVueloACancelar] = useState('')
  const [cancelando, setCancelando] = useState(false)
  const [resultadoCancelacion, setResultadoCancelacion] = useState(null)
  const [verTodosLosVuelos, setVerTodosLosVuelos] = useState(false)

  // Preparación del escenario: capacidades a 999 y planes de vuelo ajustados a
  // la hora de la sesión. Solo se usa en los minutos previos a la prueba, así
  // que el panel va plegado y no estorba durante la operación.
  const [panelPreparacion, setPanelPreparacion] = useState(false)
  const [horaPrueba, setHoraPrueba] = useState('')
  const [vuelosPrueba, setVuelosPrueba] = useState([])
  const [preparando, setPreparando] = useState(false)
  const [avisoPreparacion, setAvisoPreparacion] = useState(null)

  // Historial de registros de esta sesión (lo último arriba).
  const [registros, setRegistros] = useState([])
  const [error, setError] = useState(null)

  // G09: reporte de cierre de la jornada. Mientras sea null la jornada está
  // abierta; en cuanto existe, la operación queda congelada y se muestra el
  // reporte de la última planificación estable.
  const [cierre, setCierre] = useState(null)
  const [cerrando, setCerrando] = useState(false)

  const refrescarEstado = useCallback(async () => {
    try {
      const s = await getEstadoDiario()
      setEstado(s)
    } catch {
      setError('No se pudo obtener el estado. ¿El backend está corriendo y hay datos cargados?')
    } finally {
      setCargandoEstado(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    getAirports(0, 500)
      .then(page => { if (alive) setAeropuertos(page?.content ?? []) })
      .catch(() => {})
    refrescarEstado()
    // G09: si la jornada ya fue cerrada (p. ej. desde otro visualizador),
    // recuperamos el reporte al entrar en vez de mostrar la pantalla operativa.
    getReporteCierreDiario()
      .then(r => { if (alive && r) setCierre(r) })
      .catch(() => {})
    return () => { alive = false }
  }, [refrescarEstado])

  // Reloj de la terminal (hora del equipo, que en la prueba está en el huso de
  // la ciudad que le toca a ese estudiante).
  useEffect(() => {
    const id = setInterval(() => setReloj(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const aeropuertoTerminal = aeropuertos.find(a => a.codigoIcao === terminal) ?? null

  // Vuelos que ve el operador: los que salen de su mostrador, salvo que pida la
  // flota completa. Sin este filtro la tabla son miles de filas de aeropuertos
  // con los que esta terminal no opera.
  const vuelosVisibles = (estado?.vuelos ?? []).filter(
    v => verTodosLosVuelos || !terminal || v.origenIcao === terminal,
  )

  function fijarTerminal(icao) {
    setTerminal(icao)
    localStorage.setItem(LS_TERMINAL, icao)
    // El destino elegido podría ser ahora el propio aeropuerto de la terminal.
    if (icao === destino) setDestino('')
  }

  async function handleSubirArchivo(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a subir el mismo archivo
    if (!file) return

    setError(null)
    setResumenCarga(null)
    setSubiendo(true)
    try {
      const res = await cargarArchivoDiario(terminal, file)
      setResumenCarga(res)
      // Los registros del archivo entran al historial igual que los manuales:
      // para el operador es la misma jornada, no dos listas distintas.
      const nuevos = (res.registros ?? []).map(r => ({ ...r, ts: new Date(), deArchivo: true }))
      setRegistros(prev => [...nuevos.reverse(), ...prev].slice(0, 200))
      await refrescarEstado()
    } catch {
      setError('No se pudo cargar el archivo.')
    } finally {
      setSubiendo(false)
    }
  }

  // El identificador llega por parámetro y no del estado: los botones de la
  // tabla cancelan una fila concreta, y leerlo del estado obligaría a esperar a
  // que React lo propague — se cancelaría el vuelo anterior.
  async function cancelarVueloPorId(id) {
    const limpio = (id ?? '').trim()
    if (!limpio) return

    setError(null)
    setResultadoCancelacion(null)
    setCancelando(true)
    try {
      const res = await cancelarVueloDiario(limpio)
      setResultadoCancelacion(res)
      if (res.aplicada) setVueloACancelar('')
      await refrescarEstado()
    } catch {
      setError('No se pudo contactar con el servidor para cancelar el vuelo.')
    } finally {
      setCancelando(false)
    }
  }

  function handleCancelarVuelo(e) {
    e.preventDefault()
    return cancelarVueloPorId(vueloACancelar)
  }

  async function handleCerrar() {
    setError(null)
    setCerrando(true)
    try {
      const reporte = await cerrarOperacionDiaria()
      setCierre(reporte)
      await refrescarEstado()
    } catch {
      setError('No se pudo cerrar la jornada.')
    } finally {
      setCerrando(false)
    }
  }

  async function handleRegistrar(e) {
    e.preventDefault()
    setError(null)
    const cant = parseInt(maletas, 10)
    if (!terminal) { setError('Esta terminal no tiene aeropuerto asignado.'); return }
    if (!destino) { setError('Selecciona el destino.'); return }
    if (terminal === destino) { setError('El destino no puede ser este mismo aeropuerto.'); return }
    if (!Number.isFinite(cant) || cant <= 0) { setError('La cantidad de maletas debe ser mayor que cero.'); return }

    setEnviando(true)
    try {
      const res = await registrarEnvioDiario({
        // El origen NO lo teclea el operador: es el aeropuerto de la terminal.
        origenIcao: terminal,
        destinoIcao: destino,
        cantidadMaletas: cant,
        idCliente: cliente || null,
        // Hora del equipo, que está puesto en el huso de esta ciudad.
        fechaHoraLocal: horaLocalDelEquipo(),
      })
      setRegistros(prev => [{ ...res, ts: new Date() }, ...prev].slice(0, 50))
      if (res.aceptado) {
        setMaletas('')
      }
      await refrescarEstado()
    } catch {
      setError('No se pudo conectar con el servidor.')
    } finally {
      setEnviando(false)
    }
  }

  async function handleReset() {
    setError(null)
    try {
      const s = await reiniciarDiario()
      setEstado(s)
      setRegistros([])
      setCierre(null) // G09: reiniciar abre una jornada nueva.
    } catch {
      setError('No se pudo reiniciar.')
    }
  }

  // --- Preparación del escenario ---
  //
  // El enunciado da 8 minutos para dejar el entorno listo, y los dos cambios
  // que pide (capacidad 999 y planes de vuelo de la hora) tocan la base de
  // datos. Hacerlos desde aquí evita depender de tener consola contra la base
  // del despliegue, que es justo lo que no se tiene ese día.

  async function handlePrepararCapacidades() {
    setError(null)
    setPreparando(true)
    try {
      const r = await prepararEscenarioDiario()
      setAvisoPreparacion(r.mensaje)
      setEstado(await getEstadoDiario())
    } catch {
      setError('No se pudieron cambiar las capacidades.')
    } finally {
      setPreparando(false)
    }
  }

  async function handleRevertirCapacidades() {
    setError(null)
    setPreparando(true)
    try {
      const r = await revertirEscenarioDiario()
      setAvisoPreparacion(r.mensaje)
      setEstado(await getEstadoDiario())
    } catch {
      setError('No se pudieron revertir las capacidades.')
    } finally {
      setPreparando(false)
    }
  }

  /**
   * @param cargar false para solo verlos. El enunciado pide presentar el
   *               archivo antes de agregarlo a los planes de vuelo.
   */
  async function handleGenerarVuelos(cargar) {
    setError(null)
    if (!/^\d{1,2}:\d{2}$/.test(horaPrueba)) {
      setError('La hora debe ir como HH:mm en 24 h, por ejemplo 11:00.')
      return
    }
    setPreparando(true)
    try {
      const r = await generarVuelosPrueba(horaPrueba, !cargar)
      setVuelosPrueba(r.vuelos ?? [])
      setAvisoPreparacion(r.mensaje)
      if (cargar) setEstado(await getEstadoDiario())
    } catch (err) {
      setError(err.response?.data?.message ?? 'No se pudieron generar los vuelos.')
    } finally {
      setPreparando(false)
    }
  }

  /** Descarga las líneas generadas, por si hay que enseñar el archivo. */
  function descargarVuelos() {
    const texto = vuelosPrueba.map(v => v.linea).join('\n') + '\n'
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `planes-vuelo-adicionales-${horaPrueba.replace(':', '')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const colapso = estado?.colapsoTotal
  const ocupFlota = estado?.ocupacionFlotaPorcentaje ?? 0
  const colFlota = colorOcupacion(ocupFlota)
  const sedesPreparadas = estado?.almacenes?.length > 0
    && estado.almacenes.every(a => a.preparado)

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200">
      <NavBar />

      <div className="max-w-6xl mx-auto px-6 pt-4 flex items-center justify-between print:hidden">
        <span className="text-xs text-slate-400 uppercase tracking-widest">
          Operación Día a Día — Tiempo Real
          {cierre && <span className="ml-2 text-amber-400">· JORNADA CERRADA</span>}
        </span>
        <div className="flex gap-2">
          {/* El mapa es una pantalla aparte (el enunciado las quiere separadas),
              pero durante la operación se salta de una a otra constantemente:
              se registra aquí y se comprueba la ruta allá. */}
          <button
            onClick={() => navigate('/dia-a-dia/mapa')}
            className="px-3 py-1.5 rounded text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
          >
            🗺 Ver mapa de operaciones
          </button>
          {/* G09: cerrar congela la jornada y emite el reporte de la última
              planificación estable. Solo tiene sentido con la jornada abierta. */}
          {!cierre && (
            <button
              onClick={handleCerrar}
              disabled={cerrando}
              className="px-3 py-1.5 rounded text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 disabled:cursor-not-allowed text-white transition-colors"
            >
              {cerrando ? 'Cerrando…' : 'Cerrar operaciones del día'}
            </button>
          )}
          <button
            onClick={handleReset}
            className="px-3 py-1.5 rounded text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-700 border border-slate-700 transition-colors"
          >
            {cierre ? 'Abrir jornada nueva' : 'Reiniciar operación'}
          </button>
        </div>
      </div>

      {/* Identidad de la terminal. Es lo primero que se ve porque determina
          TODO lo demás: de aquí salen el origen de cada envío y el huso en el
          que se registra la hora de recepción. Durante la prueba, además, es lo
          que permite comprobar de un vistazo que cada equipo está puesto en la
          hora de su ciudad. */}
      {!cierre && (
        <div className="max-w-6xl mx-auto px-6 pt-3">
          {!terminal ? (
            <div className="bg-blue-500/10 border border-blue-500/40 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-blue-200 mb-1">
                ¿En qué aeropuerto está esta terminal?
              </h2>
              <p className="text-xs text-slate-400 mb-3">
                Se pregunta una sola vez. A partir de ahí, el operador solo registra
                destino, maletas y aerolínea: el origen es siempre este aeropuerto.
              </p>
              <select
                value=""
                onChange={e => e.target.value && fijarTerminal(e.target.value)}
                className="w-full max-w-sm px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="">— Selecciona el aeropuerto de esta terminal —</option>
                {aeropuertos.map(a => (
                  <option key={a.codigoIcao} value={a.codigoIcao}>
                    {a.codigoIcao} — {a.ciudad}, {a.pais} ({etiquetaGmt(a.gmt)})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="bg-slate-800 rounded-2xl border border-slate-700 px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-widest">Terminal de recepción</div>
                <div className="text-lg font-bold text-white leading-tight">
                  {aeropuertoTerminal
                    ? `${aeropuertoTerminal.ciudad} · ${terminal}`
                    : terminal}
                </div>
                {aeropuertoTerminal && (
                  <div className="text-xs text-slate-400">
                    {aeropuertoTerminal.pais} · {etiquetaGmt(aeropuertoTerminal.gmt)}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-400 uppercase tracking-widest">Hora local</div>
                <div className="text-2xl font-bold font-mono text-blue-300 leading-tight">
                  {reloj.toLocaleTimeString('es', { hour12: false })}
                </div>
                <div className="text-xs text-slate-500">
                  {reloj.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              </div>
              <button
                onClick={() => { setTerminal(''); localStorage.removeItem(LS_TERMINAL) }}
                className="text-[11px] text-slate-500 hover:text-slate-300 underline"
              >
                Cambiar terminal
              </button>
            </div>
          )}
        </div>
      )}

      {/* G09: con la jornada cerrada, la pantalla pasa a ser el reporte. */}
      {cierre && <ReporteCierre reporte={cierre} />}

      <div className={`max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 ${cierre ? 'hidden' : ''}`}>

        {/* Columna izquierda: formulario + resumen */}
        <div className="space-y-6">

          {/* Resumen / semáforo de colapso */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Estado de la operación</h2>
            <div className={`rounded-xl border p-4 mb-4 ${colapso ? 'bg-red-500/10 border-red-500/40' : colFlota.bg}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">Ocupación de la flota</span>
                <span className={`text-2xl font-bold font-mono ${colapso ? 'text-red-400' : colFlota.txt}`}>
                  {ocupFlota.toFixed(1)}%
                </span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-slate-700 overflow-hidden">
                <div className={`h-full ${colapso ? 'bg-red-500' : colFlota.bar} transition-all duration-500`}
                     style={{ width: `${Math.min(100, ocupFlota)}%` }} />
              </div>
              {colapso && (
                <p className="mt-3 text-sm text-red-400 font-semibold flex items-center gap-2">
                  ⚠ COLAPSO TOTAL — ningún vuelo admite más carga.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Metric label="Registrados" value={estado?.totalRegistrados ?? 0} clr="text-slate-200" />
              <Metric label="Aceptados" value={estado?.totalAceptados ?? 0} clr="text-green-400" />
              <Metric label="Rechazados" value={estado?.totalRechazados ?? 0} clr="text-red-400" />
              <Metric label="Maletas" value={estado?.totalMaletasDespachadas ?? 0} clr="text-blue-400" />
            </div>

            {/* Capacidad de almacén de las cuatro sedes. La prueba exige subirla
                a 999 en la preparación y hay que poder enseñarlo: la tabla de
                vuelos de abajo muestra la capacidad de cada VUELO, que es otra
                cosa y se prestaba a confusión. */}
            {estado?.almacenes?.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                    Capacidad de almacén · sedes
                  </span>
                  {estado.almacenes.every(a => a.preparado) ? (
                    <span className="text-[10px] text-green-400 font-semibold">✓ preparado</span>
                  ) : (
                    <span className="text-[10px] text-amber-400 font-semibold">sin preparar</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {estado.almacenes.map(a => (
                    <div key={a.icao}
                         className={`rounded-lg px-2.5 py-1.5 border ${
                           a.preparado
                             ? 'bg-green-500/10 border-green-500/30'
                             : 'bg-slate-700/30 border-slate-600/50'}`}>
                      <div className="text-[10px] text-slate-400 font-mono">{a.icao}</div>
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="text-[11px] text-slate-500 truncate">{a.ciudad}</span>
                        <span className={`text-sm font-bold font-mono ${
                          a.preparado ? 'text-green-400' : 'text-slate-300'}`}>
                          {a.capacidad}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Preparación de la prueba. Los dos cambios que pide el enunciado
              antes de empezar tocan la base de datos; hacerlos desde aquí evita
              depender de tener consola contra la base del despliegue. Plegado
              por defecto: solo hace falta en los minutos previos. */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
            <button
              onClick={() => setPanelPreparacion(v => !v)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-700/30 transition-colors"
            >
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Preparación de la prueba
              </span>
              <span className="flex items-center gap-2">
                {sedesPreparadas && (
                  <span className="text-[10px] text-green-400">✓ sedes listas</span>
                )}
                <span className="text-slate-500 text-xs">{panelPreparacion ? '▲' : '▼'}</span>
              </span>
            </button>

            {panelPreparacion && (
              <div className="px-5 pb-5 space-y-4 border-t border-slate-700 pt-4">
                {avisoPreparacion && (
                  <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 px-3 py-2 text-xs text-blue-300">
                    {avisoPreparacion}
                  </div>
                )}

                {/* 1. Capacidades */}
                <div>
                  <div className="text-[11px] text-slate-400 mb-2">
                    <span className="font-semibold text-slate-300">1. Capacidad de las sedes</span>
                    {' — '}el enunciado las fija en 999 durante la prueba.
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handlePrepararCapacidades}
                      disabled={preparando}
                      className="flex-1 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 text-sm font-medium transition-colors"
                    >
                      Poner en 999
                    </button>
                    <button
                      onClick={handleRevertirCapacidades}
                      disabled={preparando}
                      className="flex-1 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-sm transition-colors"
                    >
                      Restaurar originales
                    </button>
                  </div>
                </div>

                {/* 2. Planes de vuelo */}
                <div className="pt-3 border-t border-slate-700/60">
                  <div className="text-[11px] text-slate-400 mb-2">
                    <span className="font-semibold text-slate-300">2. Planes de vuelo adicionales</span>
                    {' — '}se calculan a partir de la hora de inicio, en hora de
                    Lima. Se añaden a los existentes, no los reemplazan.
                  </div>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="time"
                      value={horaPrueba}
                      onChange={e => setHoraPrueba(e.target.value)}
                      disabled={preparando}
                      className="w-32 px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-sm font-mono focus:outline-none focus:border-blue-500 disabled:opacity-50"
                    />
                    <button
                      onClick={() => handleGenerarVuelos(false)}
                      disabled={preparando || !horaPrueba}
                      className="flex-1 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-sm transition-colors"
                    >
                      Ver sin cargar
                    </button>
                    <button
                      onClick={() => handleGenerarVuelos(true)}
                      disabled={preparando || !horaPrueba}
                      className="flex-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-medium transition-colors"
                    >
                      Generar y cargar
                    </button>
                  </div>

                  {vuelosPrueba.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                          {vuelosPrueba.length} vuelos
                        </span>
                        <button
                          onClick={descargarVuelos}
                          className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          ⬇ descargar .txt
                        </button>
                      </div>
                      <pre className="max-h-40 overflow-auto rounded-lg bg-slate-900/60 border border-slate-700 p-2 text-[10px] font-mono text-slate-400 leading-relaxed">
                        {vuelosPrueba.map(v => v.linea).join('\n')}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Formulario de registro */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Registrar envío</h2>
            <form onSubmit={handleRegistrar} className="space-y-3">
              {/* Sin campo de origen: lo aporta la terminal. Se muestra para que
                  el operador sepa desde dónde está registrando, pero no es
                  editable — tecleárselo sería redundante y arriesgado. */}
              <div className="rounded-lg bg-slate-700/30 border border-slate-600/50 px-3 py-2">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Origen (esta terminal)</span>
                <div className="text-sm text-slate-300 font-mono">
                  {terminal || '— sin asignar —'}
                  {aeropuertoTerminal && (
                    <span className="text-slate-500 font-sans ml-2">
                      {aeropuertoTerminal.ciudad}
                    </span>
                  )}
                </div>
              </div>
              <SelectAeropuerto
                label="Destino"
                value={destino}
                onChange={setDestino}
                aeropuertos={aeropuertos.filter(a => a.codigoIcao !== terminal)}
              />
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Cantidad de maletas</label>
                <input
                  type="number" min="1" value={maletas}
                  onChange={e => setMaletas(e.target.value)}
                  placeholder="Ej. 50"
                  className="w-full px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Aerolínea / cliente (opcional)</label>
                <input
                  type="text" value={cliente}
                  onChange={e => setCliente(e.target.value)}
                  placeholder="Ej. LATAM"
                  className="w-full px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                type="submit" disabled={enviando || !terminal}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {enviando
                  ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Registrando…</>
                  : 'Registrar envío'}
              </button>
            </form>
          </div>

          {/* Carga en lote. El segundo grupo de envíos de la prueba llega en un
              archivo; cada línea se registra por el mismo camino que un envío
              tecleado, así que descuenta capacidad y aplica el huso igual. */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Cargar archivo de envíos
            </h2>
            <p className="text-[11px] text-slate-500 mb-3 leading-snug">
              Una línea por envío:{' '}
              <code className="text-slate-400">id-AAAAMMDD-HH-mm-DESTINO-maletas-cliente</code>.
              La hora se lee como hora local de esta terminal.
            </p>
            <label className={`block w-full py-2.5 rounded-xl text-center text-sm font-medium transition-colors ${
              terminal && !subiendo
                ? 'bg-slate-700 hover:bg-slate-600 text-slate-200 cursor-pointer'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'}`}>
              {subiendo ? 'Cargando…' : '📄 Seleccionar archivo'}
              <input
                type="file" accept=".txt,text/plain" className="hidden"
                disabled={!terminal || subiendo}
                onChange={handleSubirArchivo}
              />
            </label>
            {resumenCarga && (
              <div className="mt-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">Procesadas</span>
                  <span className="font-mono text-slate-200">{resumenCarga.lineasProcesadas}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Aceptados</span>
                  <span className="font-mono text-green-400">{resumenCarga.aceptados}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Rechazados</span>
                  <span className="font-mono text-red-400">{resumenCarga.rechazados}</span>
                </div>
                {resumenCarga.errores?.length > 0 && (
                  <ul className="mt-2 pt-2 border-t border-slate-700 space-y-0.5">
                    {resumenCarga.errores.map((er, i) => (
                      <li key={i} className="text-[10px] text-amber-400 leading-snug">{er}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Cancelación de vuelos (P&R P9). La reasignación es inmediata: la
              operación es continua y el operador necesita saber en el acto si
              las maletas tienen otro vuelo. */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Cancelar un vuelo
            </h2>
            <p className="text-[11px] text-slate-500 mb-3 leading-snug">
              Se cancela la próxima salida que despegue con al menos 1 hora de
              margen. Sus maletas se reasignan al instante.
            </p>
            <form onSubmit={handleCancelarVuelo} className="space-y-2">
              <input
                type="text" value={vueloACancelar}
                onChange={e => setVueloACancelar(e.target.value)}
                placeholder="Ej. VL-SPIM-SKBO-0024"
                className="w-full px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-200 text-sm font-mono focus:outline-none focus:border-red-500"
              />
              <button
                type="submit" disabled={cancelando || !vueloACancelar.trim()}
                className="w-full py-2 rounded-xl bg-red-600/90 hover:bg-red-500 disabled:bg-red-900 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                {cancelando ? 'Cancelando…' : '✕ Cancelar vuelo'}
              </button>
            </form>
            {resultadoCancelacion && (
              <ResultadoCancelacion res={resultadoCancelacion} />
            )}
          </div>
        </div>

        {/* Columna derecha (2 cols): historial + capacidades */}
        <div className="lg:col-span-2 space-y-6">

          {/* Historial de registros de la sesión */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Registros de la sesión</h2>
            {registros.length === 0 ? (
              <p className="text-sm text-slate-500">Aún no se ha registrado ningún envío.</p>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-y-auto">
                {registros.map((r, i) => (
                  <li key={i} className={`rounded-lg border px-3 py-2 text-sm flex items-center justify-between gap-3 ${
                    r.aceptado ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                    <div className="min-w-0">
                      <span className={`font-mono font-medium ${r.aceptado ? 'text-green-400' : 'text-red-400'}`}>
                        {r.aceptado ? '✓' : '✕'} {r.origenIcao} → {r.destinoIcao}
                      </span>
                      <span className="text-slate-400 ml-2">{r.cantidadMaletas} maletas</span>
                      {r.deArchivo && (
                        <span className="ml-2 text-[10px] text-slate-500 border border-slate-600 rounded px-1">
                          archivo
                        </span>
                      )}
                      {r.aceptado && (
                        <>
                          <span className="text-slate-500 ml-2 text-xs">
                            {r.directa ? 'directa' : `${r.escalas} escala(s)`} · {r.rutaVuelos?.join(' → ')}
                          </span>
                          {/* Las tres horas que importan al operador, cada una en
                              la hora de su propio aeropuerto: cuándo se recibió
                              aquí, cuándo se ENTREGA allá (P&R P16) y hasta
                              cuándo hay plazo. La entrega es el dato que se pide
                              al hablar de recepción en destino; el plazo solo
                              dice si llega a tiempo. */}
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            recibido {r.registradoLocal?.slice(11, 16)} {r.gmtOrigen}
                            {r.entregaLocalDestino && (
                              <>
                                {' · '}
                                <span className="text-slate-300">
                                  entrega {r.entregaLocalDestino.slice(5, 16).replace('T', ' ')} {r.gmtDestino}
                                </span>
                              </>
                            )}
                          </div>
                          {r.deadlineLocalDestino && (
                            <div className="text-[11px] text-slate-500">
                              plazo {r.deadlineLocalDestino.slice(5, 16).replace('T', ' ')} {r.gmtDestino}
                              {r.holguraMinutos != null && (
                                <span className={r.holguraMinutos >= 0 ? 'text-green-500/80' : 'text-red-400'}>
                                  {' '}({r.holguraMinutos >= 0
                                    ? `${Math.floor(r.holguraMinutos / 60)}h de holgura`
                                    : `${Math.floor(-r.holguraMinutos / 60)}h TARDE`})
                                </span>
                              )}
                            </div>
                          )}
                        </>
                      )}
                      {!r.aceptado && <span className="block text-xs text-red-300/70 truncate">{r.mensaje}</span>}
                    </div>
                    {r.envioId && (
                      <div className="shrink-0 text-right">
                        <span className="block text-xs font-mono text-slate-500">{r.envioId}</span>
                        {/* Atajo al paso de la prueba: "se selecciona un envío y
                            se debe mostrar en el mapa todas las rutas". Abre el
                            mapa con este envío ya elegido, en vez de tener que
                            buscarlo en la lista. */}
                        <button
                          onClick={() => navigate(`/dia-a-dia/mapa?envio=${encodeURIComponent(r.envioId)}`)}
                          className="mt-0.5 text-[11px] text-blue-400 hover:text-blue-300 underline"
                        >
                          ver en el mapa
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Capacidades de vuelos.

              Por defecto se muestran solo las salidas de ESTA terminal: el
              catálogo entero son miles de vuelos de todo el mundo, y el operador
              de un mostrador no opera los de otro continente. El interruptor
              permite ver toda la flota cuando hace falta (p. ej. para localizar
              un vuelo de conexión que se quiere cancelar). */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Capacidad de vuelos (en vivo)</h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">{vuelosVisibles.length} vuelos</span>
                {terminal && (
                  <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                    <input
                      type="checkbox" checked={verTodosLosVuelos}
                      onChange={e => setVerTodosLosVuelos(e.target.checked)}
                      className="accent-blue-500"
                    />
                    Ver toda la flota
                  </label>
                )}
              </div>
            </div>
            {cargandoEstado ? (
              <p className="text-sm text-slate-500">Cargando…</p>
            ) : (
              <div className="rounded-xl overflow-hidden border border-slate-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-700/50 text-slate-300">
                      <th className="text-left px-3 py-2 font-semibold">Vuelo</th>
                      <th className="text-left px-3 py-2 font-semibold">Ruta</th>
                      <th className="text-right px-3 py-2 font-semibold">Ocupado</th>
                      <th className="px-3 py-2 font-semibold w-32">Ocupación</th>
                      <th className="px-2 py-2 font-semibold w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {vuelosVisibles.map((v, i) => {
                      const c = colorOcupacion(v.ocupacionPorcentaje)
                      // El id de la fila es la salida concreta ("VUELO@fecha");
                      // para cancelar se manda el vuelo recurrente, que es lo que
                      // el backend resuelve contra la regla de la hora.
                      const plantilla = v.vueloId.split('@')[0]
                      return (
                        <tr key={v.vueloId} className={i % 2 === 0 ? 'bg-slate-800/50' : 'bg-slate-900/30'}>
                          <td className="px-3 py-2 font-mono text-xs text-slate-400">{v.vueloId}</td>
                          <td className="px-3 py-2 text-slate-300">{v.origenIcao} → {v.destinoIcao}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-400">{v.ocupado}/{v.capacidad}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                                <div className={`h-full ${c.bar}`} style={{ width: `${Math.min(100, v.ocupacionPorcentaje)}%` }} />
                              </div>
                              <span className={`text-xs font-mono w-12 text-right ${c.txt}`}>{v.ocupacionPorcentaje.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center">
                            {/* Cancelar sin teclear el identificador: copiarlo a
                                mano teniendo la fila delante es una fuente de
                                errores gratuita. */}
                            <button
                              onClick={() => cancelarVueloPorId(plantilla)}
                              disabled={cancelando}
                              title={`Cancelar ${plantilla}`}
                              className="w-6 h-6 rounded text-red-400 hover:text-white hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-xs"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Resultado de cancelar un vuelo. Separa lo reasignado de lo que quedó sin
 * ruta: son los envíos sin alternativa los que exigen una decisión del
 * operador, así que no pueden quedar mezclados con los que ya están resueltos.
 */
function ResultadoCancelacion({ res }) {
  if (!res.aplicada) {
    return <p className="mt-3 text-[11px] text-amber-400 leading-snug">{res.mensaje}</p>
  }
  return (
    <div className="mt-3 pt-3 border-t border-slate-700 space-y-2">
      <p className="text-[11px] text-red-300 leading-snug">{res.mensaje}</p>
      <div className="text-[11px] text-slate-400">
        Salida cancelada:{' '}
        <span className="font-mono text-slate-300">
          {res.origenIcao} → {res.destinoIcao}
        </span>{' '}
        el {res.fechaOperacion} a las {res.horaSalida?.slice(0, 5)}
      </div>

      {res.enviosReasignados?.length > 0 && (
        <ul className="space-y-1">
          {res.enviosReasignados.map(e => (
            <li key={e.envioId} className="rounded bg-green-500/5 border border-green-500/20 px-2 py-1.5">
              <div className="text-[11px] text-green-400 font-mono">
                ✓ {e.envioId} reasignado ({e.cantidadMaletas} maletas)
              </div>
              <div className="text-[10px] text-slate-500 line-through">
                {e.rutaAnterior?.join(' → ')}
              </div>
              <div className="text-[10px] text-slate-300 font-mono">
                {e.rutaNueva?.join(' → ')}
              </div>
            </li>
          ))}
        </ul>
      )}

      {res.enviosSinRuta?.length > 0 && (
        <ul className="space-y-1">
          {res.enviosSinRuta.map(e => (
            <li key={e.envioId} className="rounded bg-red-500/10 border border-red-500/30 px-2 py-1.5">
              <div className="text-[11px] text-red-300 font-mono">
                ✕ {e.envioId} sin ruta alternativa ({e.cantidadMaletas} maletas)
              </div>
              <div className="text-[10px] text-slate-400">
                {e.origenIcao} → {e.destinoIcao} · requiere decisión del operador
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Metric({ label, value, clr }) {
  return (
    <div className="bg-slate-700/40 rounded-lg px-3 py-2.5 border border-slate-600/50 text-center">
      <div className={`text-xl font-bold font-mono leading-none ${clr}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  )
}

// G09: reporte de la última planificación estable al cerrar las operaciones
// día a día. Mismo formato que el reporte de periodo (imprimible) para que los
// tres escenarios se presenten de forma consistente.
function fmtFecha(dt) {
  if (!dt) return '—'
  return String(dt).replace('T', ' ').slice(0, 19)
}

function ReporteCierre({ reporte }) {
  const atencion = reporte.porcentajeAtencion ?? 0
  const colorAtencion = atencion >= 95 ? 'text-green-400' : atencion >= 85 ? 'text-amber-400' : 'text-red-400'
  const atendidos = reporte.enviosAtendidos ?? []
  const rechazados = reporte.enviosRechazados ?? []

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-5 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-white">Reporte de Cierre — Operación Día a Día</h1>
          <p className="text-slate-400 text-sm">Última planificación estable de la jornada</p>
        </div>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
        >
          🖨 Imprimir / PDF
        </button>
      </div>

      <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden print:bg-white">
        {/* Desenlace de la jornada */}
        <div className={`px-6 py-4 border-b border-slate-700 ${
          reporte.colapsoTotal ? 'bg-red-500/10' : ''
        }`}>
          <div className="text-xs text-slate-400 uppercase tracking-widest mb-1">Cierre de jornada</div>
          <div className={`text-sm font-medium ${reporte.colapsoTotal ? 'text-red-400' : 'text-slate-200'}`}>
            {reporte.colapsoTotal ? '⚠ ' : ''}{reporte.motivo}
          </div>
        </div>

        {/* Cumplimiento destacado */}
        <div className="px-6 py-6 border-b border-slate-700 text-center">
          <div className="text-xs text-slate-400 uppercase tracking-widest mb-1">Envíos atendidos</div>
          <div className={`text-5xl font-bold ${colorAtencion}`}>{atencion}%</div>
          <div className="text-xs text-slate-500 mt-1">
            {reporte.totalAceptados} de {reporte.totalRegistrados} envíos registrados
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-slate-700">
          <KpiCierre label="Atendidos" value={reporte.totalAceptados} clr="text-green-400" />
          <KpiCierre label="Rechazados" value={reporte.totalRechazados} clr="text-red-400" />
          <KpiCierre label="Maletas despachadas" value={reporte.totalMaletasDespachadas} clr="text-blue-400" />
          <KpiCierre label="Ocupación de flota" value={`${reporte.ocupacionFlotaPorcentaje}%`} clr="text-white" raw />
          <KpiCierre label="Vuelos saturados" value={`${reporte.vuelosSaturados}/${reporte.vuelosOperados}`} clr="text-amber-400" raw />
          <KpiCierre label="Registrados" value={reporte.totalRegistrados} clr="text-slate-300" />
        </div>

        {/* Tiempos */}
        <div className="px-6 py-4 border-t border-slate-700 text-sm space-y-1">
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Inicio de operación</span>
            <span className="text-slate-200 font-mono">{fmtFecha(reporte.inicioOperacion)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Cierre</span>
            <span className="text-slate-200 font-mono">{fmtFecha(reporte.fechaCierre)}</span>
          </div>
        </div>

        {/* Detalle de envíos atendidos */}
        <div className="px-6 py-4 border-t border-slate-700">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Envíos atendidos ({atendidos.length})
          </h3>
          {atendidos.length === 0 ? (
            <p className="text-sm text-slate-500">Ninguno.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto print:max-h-none print:overflow-visible">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 text-xs">
                    <th className="text-left py-1.5 font-semibold">Envío</th>
                    <th className="text-left py-1.5 font-semibold">Ruta</th>
                    <th className="text-right py-1.5 font-semibold">Maletas</th>
                    <th className="text-left py-1.5 font-semibold pl-3">Plan de vuelos</th>
                  </tr>
                </thead>
                <tbody>
                  {atendidos.map(e => (
                    <tr key={e.envioId} className="border-t border-slate-700/50">
                      <td className="py-1.5 font-mono text-xs text-slate-400">{e.envioId}</td>
                      <td className="py-1.5 text-slate-300">{e.origenIcao} → {e.destinoIcao}</td>
                      <td className="py-1.5 text-right font-mono text-slate-400">{e.cantidadMaletas}</td>
                      <td className="py-1.5 pl-3 text-xs text-slate-500">
                        {e.directa ? 'directa' : `${e.escalas} escala(s)`} · {(e.rutaVuelos ?? []).join(' → ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detalle de rechazos */}
        {rechazados.length > 0 && (
          <div className="px-6 py-4 border-t border-slate-700">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Envíos no atendidos ({rechazados.length})
            </h3>
            <ul className="space-y-1.5 max-h-60 overflow-y-auto print:max-h-none print:overflow-visible">
              {rechazados.map((r, i) => (
                <li key={i} className="text-sm flex justify-between gap-3 border-t border-slate-700/50 pt-1.5">
                  <span className="font-mono text-red-400 shrink-0">
                    {r.origenIcao} → {r.destinoIcao} ({r.cantidadMaletas})
                  </span>
                  <span className="text-xs text-slate-500 text-right">{r.motivo}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Vuelos más cargados al cierre */}
        {(reporte.vuelosMasCargados ?? []).length > 0 && (
          <div className="px-6 py-4 border-t border-slate-700">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Vuelos más cargados al cierre
            </h3>
            <div className="space-y-1.5">
              {reporte.vuelosMasCargados.map(v => {
                const c = colorOcupacion(v.ocupacionPorcentaje)
                return (
                  <div key={v.vueloId} className="flex items-center gap-2 text-xs">
                    <span className="text-slate-300 w-28 shrink-0">{v.origenIcao} → {v.destinoIcao}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                      <div className={`h-full ${c.bar}`} style={{ width: `${Math.min(100, v.ocupacionPorcentaje)}%` }} />
                    </div>
                    <span className={`font-mono w-20 text-right ${c.txt}`}>
                      {v.ocupado}/{v.capacidad}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function KpiCierre({ label, value, clr, raw = false }) {
  return (
    <div className="bg-slate-800 px-4 py-4 text-center print:bg-white">
      <div className={`text-2xl font-bold font-mono ${clr}`}>
        {raw ? value : Number(value ?? 0).toLocaleString()}
      </div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  )
}

function SelectAeropuerto({ label, value, onChange, aeropuertos }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
      >
        <option value="">— Selecciona —</option>
        {aeropuertos.map(a => (
          <option key={a.codigoIcao} value={a.codigoIcao}>
            {a.codigoIcao} — {a.ciudad}, {a.pais}
          </option>
        ))}
      </select>
    </div>
  )
}
