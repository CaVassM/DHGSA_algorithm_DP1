import axios from 'axios'

const api = axios.create({
  baseURL: 'http://localhost:8080/api/v1',
  timeout: 60000,
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

export async function reiniciarDiario() {
  const { data } = await api.post('/daily/reset')
  return data
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
