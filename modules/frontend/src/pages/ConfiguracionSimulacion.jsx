import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { startPlanningRun, getImportStatus, getShipments, importShipments, importAirports, importFlights } from '../services/api'

const UMBRALES = [
  { indicador: 'Almacenes',    verde: '< 60%',       ambar: '60% - 85%',   rojo: '> 85%' },
  { indicador: 'Vuelos',       verde: '50% - 70%',   ambar: '<50% o >70%', rojo: '> 90%' },
  { indicador: 'Cumplimiento', verde: '> 95%',        ambar: '85% - 95%',   rojo: '< 85%' },
]

const BASE_PLANNING_REQUEST = {
  algorithm:        'IALNS_SA',
  scenario:         'PERIOD_SIMULATION',
  horizonDays:      5,
  epochHours:       4,
  populationSize:   6,
  timeLimitSeconds: 2,
  dataSetReference: 'DB',
}

function toDateTimeLocalValue(dateTimeString) {
  if (!dateTimeString) return ''
  return String(dateTimeString).slice(0, 16)
}

export default function ConfiguracionSimulacion() {
  const navigate     = useNavigate()
  const fileInputRef = useRef(null)

  // ── Import status ──────────────────────────────────────────────────────────
  const [importStatus, setImportStatus] = useState(null)   // null = cargando
  const [statusErr,    setStatusErr]    = useState(false)

  // ── Import action ──────────────────────────────────────────────────────────
  const [selectedFiles, setSelectedFiles] = useState([])
  const [importing,     setImporting]     = useState(false)
  const [importErr,     setImportErr]     = useState(null)
  const [importDone,    setImportDone]    = useState(null)  // ImportSummaryResponse

  // ── Start simulation ───────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [planningStart, setPlanningStart] = useState('')
  const [maxPlanningStart, setMaxPlanningStart] = useState('')

  async function loadPlanningDateLimit() {
    try {
      const page = await getShipments(0, 1, 'fechaHoraCreacion,desc')
      const latest = page?.content?.[0]?.fechaHoraCreacion
      if (!latest) {
        setMaxPlanningStart('')
        setPlanningStart('')
        return
      }

      const latestLocal = toDateTimeLocalValue(latest)
      setMaxPlanningStart(latestLocal)
      setPlanningStart(prev => {
        if (!prev || prev > latestLocal) return latestLocal
        return prev
      })
    } catch {
      // Si falla esta consulta, se mantiene la validación básica por campo requerido.
      setMaxPlanningStart('')
    }
  }

  // Re-consulta el estado de la BD y recalcula el límite de fecha (tras cualquier importación)
  async function refreshStatus() {
    try {
      const s = await getImportStatus()
      setImportStatus(s)
      setStatusErr(false)
      if (s.shipmentsCount > 0) await loadPlanningDateLimit()
    } catch {
      setStatusErr(true)
    }
  }

  // Consultar status al montar
  useEffect(() => {
    let alive = true
    getImportStatus()
      .then(async s => {
        if (!alive) return
        setImportStatus(s)
        setStatusErr(false)
        if (s.shipmentsCount > 0) {
          await loadPlanningDateLimit()
        }
      })
      .catch(() => { if (alive) setStatusErr(true) })
    return () => { alive = false }
  }, [])

  async function handleImport() {
    if (selectedFiles.length === 0) return
    setImporting(true)
    setImportErr(null)
    setImportDone(null)
    try {
      const result = await importShipments(selectedFiles)
      setImportDone(result)
      setSelectedFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      // Re-fetch para obtener el total real en BD
      const updated = await getImportStatus()
      setImportStatus(updated)
      if (updated.shipmentsCount > 0) {
        await loadPlanningDateLimit()
      }
    } catch (err) {
      setImportErr(err.response?.data?.message ?? 'Error al importar los archivos.')
    } finally {
      setImporting(false)
    }
  }

  async function handleIniciar() {
    if (!planningStart) {
      setError('Selecciona una fecha de inicio para la planificación.')
      return
    }
    if (maxPlanningStart && planningStart > maxPlanningStart) {
      setError('La fecha de inicio no puede ser mayor que la última fecha disponible en envíos.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const response = await startPlanningRun({
        ...BASE_PLANNING_REQUEST,
        planningStart: `${planningStart}:00`,
      })

      // El run corre en background (async en el backend). NO esperamos a que
      // termine antes de entrar: con datasets grandes eso atrapa al usuario en
      // "Planificando..." y le impide llegar al Dashboard (y a la Simulación en
      // Vivo). Navegamos de inmediato; el Dashboard hace polling del estado del
      // run y va animando cuando hay rutas.
      navigate('/dashboard', { state: { runId: response.runId } })
    } catch (err) {
      setError(err.response?.data?.message ?? err.message ?? 'No se pudo conectar con el servidor. Verifica que el backend esté corriendo.')
      setLoading(false)
    }
  }

  const shipmentsReady = importStatus !== null && importStatus.shipmentsCount > 0
  const isPlanningStartValid = Boolean(planningStart) && (!maxPlanningStart || planningStart <= maxPlanningStart)
  const canStart       = shipmentsReady && !loading && !statusErr && isPlanningStartValid

  return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white text-sm font-bold">T</span>
            </div>
            <span className="text-slate-400 text-sm font-medium uppercase tracking-widest">Tasf.B2B</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Configuración de Simulación</h1>
          <p className="text-slate-400 text-sm">Sistema de Gestión de Equipajes Extraviados</p>
        </div>

        {/* Card principal */}
        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden mb-4">

          {/* Sección de datos de envíos */}
          <div className="p-6 border-b border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Datos de Envíos</h2>
              {importStatus === null && !statusErr && (
                <span className="text-xs text-slate-500 flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full border-2 border-slate-500 border-t-transparent animate-spin inline-block" />
                  Verificando...
                </span>
              )}
              {shipmentsReady && (
                <span className="text-xs text-green-400 flex items-center gap-1 font-medium">
                  ✓ Listo para simular
                </span>
              )}
              {statusErr && (
                <span className="text-xs text-red-400">No se pudo verificar el estado</span>
              )}
            </div>

            {/* Chips de conteo */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <StatusChip
                label="Aeropuertos"
                count={importStatus?.airportsCount ?? '—'}
                ready={importStatus?.airportsCount > 0}
              />
              <StatusChip
                label="Vuelos"
                count={importStatus?.flightsCount ?? '—'}
                ready={importStatus?.flightsCount > 0}
              />
              <StatusChip
                label="Envíos"
                count={importStatus?.shipmentsCount ?? '—'}
                ready={shipmentsReady}
                pending={importStatus !== null && !shipmentsReady}
              />
            </div>

            {/* Zona de carga de datos — siempre disponible (upsert: no duplica) */}
            {importStatus !== null && (
              <div className="rounded-xl border border-dashed border-slate-600 p-4 space-y-4">
                <p className="text-xs text-slate-400">
                  Carga o actualiza los datos maestros. Es <span className="text-slate-300">upsert</span>: puedes volver
                  a subir para reemplazar/agregar sin duplicar.
                </p>

                <SingleFileImport
                  label="Aeropuertos"
                  hint="lista de aeropuertos (.txt)"
                  accept=".txt"
                  onUpload={importAirports}
                  onDone={refreshStatus}
                />

                <SingleFileImport
                  label="Vuelos"
                  hint="plan de vuelos (.txt)"
                  accept=".txt"
                  onUpload={importFlights}
                  onDone={refreshStatus}
                />

                {/* Envíos (multi-archivo) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-slate-300">Envíos</span>
                    <span className="text-xs text-slate-500 font-mono">archivos de envíos (.txt, varios)</span>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer group mb-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt"
                      multiple
                      className="hidden"
                      onChange={e => setSelectedFiles(Array.from(e.target.files ?? []))}
                    />
                    <div className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-xs text-slate-400 group-hover:border-slate-500 transition-colors truncate">
                      {selectedFiles.length === 0
                        ? 'Ningún archivo seleccionado'
                        : selectedFiles.length === 1
                          ? selectedFiles[0].name
                          : `${selectedFiles.length} archivos seleccionados`}
                    </div>
                    <span className="shrink-0 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-600 text-xs text-slate-200 font-medium transition-colors">
                      Elegir
                    </span>
                  </label>

                  {selectedFiles.length > 0 && (
                    <ul className="mb-2 space-y-1">
                      {selectedFiles.map(f => (
                        <li key={f.name} className="text-xs font-mono text-slate-400 flex items-center gap-1.5">
                          <span className="text-slate-600">•</span>
                          {f.name}
                        </li>
                      ))}
                    </ul>
                  )}

                  <button
                    onClick={handleImport}
                    disabled={selectedFiles.length === 0 || importing}
                    className="w-full py-2 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {importing ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Cargando...
                      </>
                    ) : (
                      'Cargar / actualizar envíos'
                    )}
                  </button>

                  {importErr && <p className="mt-2 text-xs text-red-400">{importErr}</p>}
                  {importDone && (
                    <div className="mt-2 rounded-lg bg-green-500/10 border border-green-500/30 px-3 py-2 text-xs text-green-400">
                      {importDone.insertedCount} envíos nuevos
                      {importDone.updatedCount > 0 ? `, ${importDone.updatedCount} actualizados` : ''}.
                      {importDone.skippedCount > 0 ? ` ${importDone.skippedCount} ignorados (aeropuerto no encontrado).` : ''}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Parámetros */}
          <div className="p-6 border-b border-slate-700">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Parámetros de Simulación</h2>
            <div className="grid grid-cols-2 gap-4">
              <ParamCard label="Periodo a simular"     value="5 días"          icon="📅" />
              <ParamCard label="Algoritmo planificador" value="Genético (AG)"  icon="🧬" />
              <ParamCard label="Duración estimada"      value="~60 minutos"    icon="⏱"  />
              <ParamCard label="Carga inicial"           value="20,485 maletas" icon="🧳" />
            </div>
            <div className="mt-4">
              <label className="block text-xs text-slate-400 mb-1.5">Fecha de inicio de planificación</label>
              <input
                type="datetime-local"
                value={planningStart}
                max={maxPlanningStart || undefined}
                onChange={e => setPlanningStart(e.target.value)}
                disabled={!shipmentsReady || loading}
                className="w-full px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-200 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-slate-500">
                {maxPlanningStart
                  ? `Máximo permitido por envíos: ${maxPlanningStart.replace('T', ' ')}`
                  : 'El límite se habilita cuando hay envíos disponibles.'}
              </p>
            </div>
          </div>

          {/* Tabla de umbrales */}
          <div className="p-6">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Umbrales de Semáforo</h2>
            <div className="rounded-xl overflow-hidden border border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700/50">
                    <th className="text-left px-4 py-3 text-slate-300 font-semibold">Indicador</th>
                    <th className="px-4 py-3 text-green-400 font-semibold text-center">Verde</th>
                    <th className="px-4 py-3 text-amber-400 font-semibold text-center">Ámbar</th>
                    <th className="px-4 py-3 text-red-400 font-semibold text-center">Rojo</th>
                  </tr>
                </thead>
                <tbody>
                  {UMBRALES.map((u, i) => (
                    <tr key={u.indicador} className={i % 2 === 0 ? 'bg-slate-800/50' : 'bg-slate-750/30'}>
                      <td className="px-4 py-3 text-white font-medium">{u.indicador}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block bg-green-500/15 text-green-400 border border-green-500/30 rounded px-2 py-0.5 text-xs font-mono">
                          {u.verde}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded px-2 py-0.5 text-xs font-mono">
                          {u.ambar}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block bg-red-500/15 text-red-400 border border-red-500/30 rounded px-2 py-0.5 text-xs font-mono">
                          {u.rojo}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Error al iniciar */}
        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Botón iniciar */}
        <button
          onClick={handleIniciar}
          disabled={!canStart}
          className="w-full py-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold text-base rounded-xl transition-colors duration-200 flex items-center justify-center gap-3 shadow-lg shadow-blue-900/40"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Iniciando... (entrando al mapa)
            </>
          ) : (
            <>
              <span className="text-lg">▶</span>
              Iniciar Simulación de 5 Días
            </>
          )}
        </button>

        <p className="text-center text-slate-500 text-xs mt-4">
          {importStatus === null && !statusErr
            ? 'Verificando datos...'
            : shipmentsReady
              ? `${importStatus.shipmentsCount.toLocaleString()} envíos en BD — dataset listo${planningStart ? '.' : ', falta elegir fecha de inicio.'}`
              : 'Carga los archivos de envíos para habilitar la simulación.'}
        </p>
      </div>
    </div>
  )
}

function ParamCard({ label, value, icon }) {
  return (
    <div className="bg-slate-700/40 rounded-xl p-4 border border-slate-600/50">
      <div className="text-xl mb-2">{icon}</div>
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-white font-semibold text-base">{value}</div>
    </div>
  )
}

function SingleFileImport({ label, hint, accept, onUpload, onDone }) {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)
  const [done, setDone] = useState(null)

  async function handle() {
    if (!file) return
    setBusy(true); setErr(null); setDone(null)
    try {
      const result = await onUpload(file)
      setDone(result)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      await onDone?.()
    } catch (e) {
      setErr(e.response?.data?.message ?? 'Error al cargar el archivo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-slate-300">{label}</span>
        <span className="text-xs text-slate-500 font-mono">{hint}</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex-1 flex items-center gap-2 cursor-pointer group min-w-0">
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-xs text-slate-400 group-hover:border-slate-500 transition-colors truncate">
            {file ? file.name : 'Ningún archivo seleccionado'}
          </div>
          <span className="shrink-0 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-600 text-xs text-slate-200 font-medium transition-colors">
            Elegir
          </span>
        </label>
        <button
          onClick={handle}
          disabled={!file || busy}
          className="shrink-0 px-3 py-2 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
        >
          {busy ? '...' : 'Cargar'}
        </button>
      </div>
      {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
      {done && (
        <p className="mt-1 text-xs text-green-400">
          {done.insertedCount} nuevos{done.updatedCount > 0 ? `, ${done.updatedCount} actualizados` : ''}
          {done.skippedCount > 0 ? `, ${done.skippedCount} ignorados` : ''}.
        </p>
      )}
    </div>
  )
}

function StatusChip({ label, count, ready, pending = false }) {
  const bg      = ready   ? 'bg-green-500/10 border-green-500/30'
                : pending ? 'bg-amber-500/10 border-amber-500/30'
                :           'bg-slate-700/40 border-slate-600/50'
  const numClr  = ready   ? 'text-green-400'
                : pending ? 'text-amber-400'
                :           'text-slate-400'
  return (
    <div className={`rounded-lg px-3 py-2.5 border text-center ${bg}`}>
      <div className={`text-lg font-bold font-mono leading-none ${numClr}`}>
        {typeof count === 'number' ? count.toLocaleString() : count}
      </div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  )
}
