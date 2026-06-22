import axios from 'axios'

const api = axios.create({
  baseURL: 'http://localhost:8080/api/v1',
  timeout: 5000,
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

// --- Admin imports ---

export async function getImportStatus() {
  const { data } = await api.get('/admin/imports/status')
  return data
}

export async function importShipments(files) {
  const formData = new FormData()
  files.forEach(f => formData.append('files', f))
  const { data } = await api.post('/admin/imports/shipments', formData, { timeout: 30000 })
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
