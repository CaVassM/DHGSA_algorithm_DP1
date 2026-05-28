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

export async function getShipments(page = 0, size = 100) {
  const { data } = await api.get('/shipments', { params: { page, size } })
  return data
}
