import api from "./api";

export async function iniciarPlanificacion(request) {
  const response = await api.post("/planning-runs", request);
  return response.data;
}

export async function obtenerRun(runId) {
  const response = await api.get(`/planning-runs/${runId}`);
  return response.data;
}

export async function obtenerRutasRun(runId) {
  const response = await api.get(`/planning-runs/${runId}/routes`);
  return response.data;
}

export async function obtenerAeropuertos() {
  const response = await api.get("/airports");
  return response.data;
}