import axios from 'axios'
import { API_URL } from './backendUrl'

// G06: la base ya no está escrita a mano — se resuelve desde el host que sirvió
// la página, para que la app funcione abierta desde otro dispositivo de la red.
const api = axios.create({
  baseURL: API_URL,
  timeout: 600000,
})

export default api

// --- Planner ---

export async function startPlanningRun(planningRequest) {
  const { data } = await api.post('/planner/runs', planningRequest)
  return data
}

export async function getPlanningRun(runId) {
  const { data } = await api.get(`/planner/runs/${runId}`)
  return data
}

// Último run terminado (COMPLETED o COMPLETED_WITH_PENDING_SHIPMENTS).
// Sirve para que el Dashboard tenga algo que animar cuando se entra directo
// sin pasar por la pantalla de planificación (o si el runId guardado quedó
// obsoleto). Devuelve null si no hay ninguno.
export async function getLatestRun() {
  const { data } = await api.get('/planner/runs', {
    params: { page: 0, size: 10, sort: 'id,desc' },
  })
  const runs = data?.content ?? []
  const terminal = new Set(['COMPLETED', 'COMPLETED_WITH_PENDING_SHIPMENTS'])
  return runs.find(r => terminal.has(r.status)) ?? null
}

export async function getPlanningRunRoutes(runId) {
  const { data } = await api.get(`/planner/runs/${runId}/routes`)
  console.log('[API] getPlanningRunRoutes response:', data)
  return data
}

// --- Master data ---

export async function getAirports(page = 0, size = 100) {
  const { data } = await api.get('/airports', { params: { page, size } })
  return data
}

export async function getFlights(page = 0, size = 100) {
  const { data } = await api.get('/flights', { params: { page, size } })
  return data
}

export async function getShipments(page = 0, size = 100, sort = null) {
  const params = { page, size }
  if (sort) params.sort = sort
  const { data } = await api.get('/shipments', { params })
  return data
}

// --- Operación día a día (REAL_TIME) ---

export async function registrarEnvioDiario(request) {
  // El backend devuelve 422 cuando rechaza (sin ruta / colapso); axios lanza,
  // pero el cuerpo trae { aceptado:false, mensaje }. Lo devolvemos igual.
  try {
    const { data } = await api.post('/daily/shipments', request)
    return data
  } catch (err) {
    if (err.response?.status === 422 && err.response.data) {
      return err.response.data
    }
    throw err
  }
}

export async function getEstadoDiario() {
  const { data } = await api.get('/daily/state')
  return data
}

// Carga en lote de envíos desde un archivo de texto. Cada línea se registra por
// el mismo camino que un envío manual, así que puede aceptarse o rechazarse por
// los mismos motivos; el detalle llega por línea.
export async function cargarArchivoDiario(origenIcao, file) {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await api.post('/daily/shipments/upload', formData, {
    params: { origenIcao },
    timeout: 120000,
  })
  return data
}

// P&R P9: cancela un vuelo y reasigna sus maletas en el acto. Devuelve el cuerpo
// también cuando rechaza (422), que trae el motivo.
export async function cancelarVueloDiario(idVuelo) {
  try {
    const { data } = await api.post(`/daily/flights/${encodeURIComponent(idVuelo)}/cancel`)
    return data
  } catch (err) {
    if (err.response?.status === 422 && err.response.data) {
      return err.response.data
    }
    throw err
  }
}

export async function reiniciarDiario() {
  const { data } = await api.post('/daily/reset')
  return data
}

// G09: cierra la jornada y devuelve el reporte de la última planificación
// estable. Tras esto el backend no admite más registros hasta reiniciar.
export async function cerrarOperacionDiaria() {
  const { data } = await api.post('/daily/close')
  return data
}

// G09: reporte de la jornada ya cerrada. Devuelve null (204) si sigue abierta,
// para que al entrar a la pantalla se recupere el cierre sin volver a cerrarlo.
export async function getReporteCierreDiario() {
  const { data, status } = await api.get('/daily/close', {
    validateStatus: s => s === 200 || s === 204,
  })
  return status === 204 ? null : data
}

// --- Simulación de periodo en vivo (salto de algoritmo) ---

export async function iniciarSimulacionEnVivo(request) {
  const { data } = await api.post('/simulacion/live', request)
  return data // { runId, topic, mensaje }
}

export async function cancelarSimulacionEnVivo(runId) {
  const { data } = await api.post(`/simulacion/live/${runId}/cancel`)
  return data
}

// P&R P9 / D14: cancelar un vuelo durante la simulación. El backend elige la
// salida afectada (la próxima con al menos una hora de margen sobre el reloj
// simulado) y libera las maletas que llevaba. Devuelve el cuerpo también cuando
// rechaza (422), que trae el motivo.
export async function cancelarVuelo(idVuelo) {
  try {
    const { data } = await api.post(`/simulacion/flights/${encodeURIComponent(idVuelo)}/cancel`)
    return data
  } catch (err) {
    if (err.response?.status === 422 && err.response.data) {
      return err.response.data
    }
    throw err
  }
}

export async function iniciarSimulacionColapso(request) {
  const { data } = await api.post('/simulacion/collapse', request)
  return data // { runId, topic, mensaje }
}

// --- Admin imports ---

export async function getImportStatus() {
  const { data } = await api.get('/admin/imports/status')
  return data
}

export async function importShipments(files) {
  const formData = new FormData()
  files.forEach(f => formData.append('files', f))
  const { data } = await api.post('/admin/imports/shipments', formData, { timeout: 600000 })
  return data
}

export async function importAirports(file) {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await api.post('/admin/imports/airports', formData, { timeout: 30000 })
  return data
}

export async function importFlights(file) {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await api.post('/admin/imports/flights', formData, { timeout: 30000 })
  return data
}
