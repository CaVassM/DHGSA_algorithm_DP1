// mapX/mapY use equirectangular projection into the 1000×500 SVG viewBox:
//   x_svg = (lon + 180) / 360 * 1000  →  mapX = x_svg / 10  (parseFloat * 10 in pctToXY)
//   y_svg = (90 - lat) / 180 * 500    →  mapY = y_svg / 5   (parseFloat * 5  in pctToXY)
export const AEROPUERTOS = {
  JFK: {
    codigo: 'JFK',
    nombre: 'John F. Kennedy International',
    ciudad: 'Nueva York',
    continente: 'América',
    mapX: '29.51%',  // lon -73.779°
    mapY: '27.42%',  // lat  40.641°N
    almacen: { actual: 350, capacidad: 800 },
    maletasEnRiesgo: 12,
    vuelosProximos: 3,
    ultimaActualizacion: '12:44 PM',
  },
  MEX: {
    codigo: 'MEX',
    nombre: 'Aeropuerto Internacional Benito Juárez',
    ciudad: 'Ciudad de México',
    continente: 'América',
    mapX: '22.48%',  // lon -99.072°
    mapY: '39.20%',  // lat  19.436°N
    almacen: { actual: 420, capacidad: 500 },
    maletasEnRiesgo: 38,
    vuelosProximos: 5,
    ultimaActualizacion: '12:43 PM',
  },
  GRU: {
    codigo: 'GRU',
    nombre: 'Aeropuerto Internacional de Guarulhos',
    ciudad: 'São Paulo',
    continente: 'América',
    mapX: '37.09%',  // lon -46.474°
    mapY: '63.02%',  // lat  23.435°S
    almacen: { actual: 380, capacidad: 600 },
    maletasEnRiesgo: 21,
    vuelosProximos: 4,
    ultimaActualizacion: '12:42 PM',
  },
  LHR: {
    codigo: 'LHR',
    nombre: 'Aeropuerto de Heathrow',
    ciudad: 'Londres',
    continente: 'Europa',
    mapX: '49.87%',  // lon  -0.454°
    mapY: '21.41%',  // lat  51.470°N
    almacen: { actual: 850, capacidad: 1000 },
    maletasEnRiesgo: 55,
    vuelosProximos: 7,
    ultimaActualizacion: '12:45 PM',
  },
  FRA: {
    codigo: 'FRA',
    nombre: 'Aeropuerto Internacional de Fráncfort',
    ciudad: 'Fráncfort',
    continente: 'Europa',
    mapX: '52.38%',  // lon   8.562°E
    mapY: '22.20%',  // lat  50.038°N
    almacen: { actual: 600, capacidad: 900 },
    maletasEnRiesgo: 18,
    vuelosProximos: 6,
    ultimaActualizacion: '12:40 PM',
  },
  MAD: {
    codigo: 'MAD',
    nombre: 'Aeropuerto Adolfo Suárez Madrid-Barajas',
    ciudad: 'Madrid',
    continente: 'Europa',
    mapX: '49.01%',  // lon  -3.566°
    mapY: '27.52%',  // lat  40.471°N
    almacen: { actual: 300, capacidad: 700 },
    maletasEnRiesgo: 7,
    vuelosProximos: 4,
    ultimaActualizacion: '12:38 PM',
  },
  DXB: {
    codigo: 'DXB',
    nombre: 'Aeropuerto Internacional de Dubái',
    ciudad: 'Dubái',
    continente: 'Asia',
    mapX: '65.38%',  // lon  55.364°E
    mapY: '35.97%',  // lat  25.252°N
    almacen: { actual: 400, capacidad: 800 },
    maletasEnRiesgo: 14,
    vuelosProximos: 5,
    ultimaActualizacion: '12:41 PM',
  },
  PEK: {
    codigo: 'PEK',
    nombre: 'Aeropuerto Internacional Capital de Pekín',
    ciudad: 'Pekín',
    continente: 'Asia',
    mapX: '82.39%',  // lon 116.605°E
    mapY: '27.73%',  // lat  40.080°N
    almacen: { actual: 1250, capacidad: 1500 },
    maletasEnRiesgo: 44,
    vuelosProximos: 6,
    ultimaActualizacion: '12:39 PM',
  },
  HND: {
    codigo: 'HND',
    nombre: 'Aeropuerto Internacional de Haneda',
    ciudad: 'Tokio',
    continente: 'Asia',
    mapX: '88.83%',  // lon 139.780°E
    mapY: '30.25%',  // lat  35.553°N
    almacen: { actual: 950, capacidad: 1100 },
    maletasEnRiesgo: 67,
    vuelosProximos: 4,
    ultimaActualizacion: '12:45 PM',
  },
}

export const RUTAS = [
  { desde: 'JFK', hasta: 'LHR' },
  { desde: 'JFK', hasta: 'MAD' },
  { desde: 'MEX', hasta: 'MAD' },
  { desde: 'MEX', hasta: 'FRA' },
  { desde: 'GRU', hasta: 'FRA' },
  { desde: 'GRU', hasta: 'DXB' },
  { desde: 'LHR', hasta: 'DXB' },
  { desde: 'FRA', hasta: 'DXB' },
  { desde: 'DXB', hasta: 'PEK' },
  { desde: 'DXB', hasta: 'HND' },
  { desde: 'PEK', hasta: 'HND' },
]

export function getOcupacionPct(aeropuerto) {
  return Math.round((aeropuerto.almacen.actual / aeropuerto.almacen.capacidad) * 100 * 10) / 10
}

// Umbrales (en % de ocupación) del semáforo de CARGA del almacén. Los términos
// describen cuánta capacidad se está usando, sin emitir juicio de valor
// (no es "óptimo/riesgo/crítico"). Parametrizables: ajustar estos rangos cambia
// el comportamiento en todo el frontend (mapa, detalle, barras y leyenda).
//   ocupación <= vacio  → VACÍO       (almacén sin maletas)
//   ocupación <  ambar  → VERDE       (baja carga)
//   ambar <= ocupación <= rojo → ÁMBAR (carga media)
//   ocupación >  rojo   → ROJO        (carga alta / lleno)
export const UMBRALES_ALMACEN = {
  vacio: 0,   // % máximo considerado VACÍO (0 maletas)
  ambar: 60,  // % a partir del cual entra en ÁMBAR
  rojo:  85,  // % a partir del cual (estrictamente mayor) entra en ROJO
}

export function getSemaforoPorOcupacion(pct, umbrales = UMBRALES_ALMACEN) {
  if (pct <= umbrales.vacio) return 'vacio'
  if (pct >  umbrales.rojo)  return 'rojo'
  if (pct >= umbrales.ambar) return 'ambar'
  return 'verde'
}

export const SEMAFORO_COLORES = {
  vacio: '#94a3b8',  // slate-400 — color propio del estado VACÍO, distinto del verde
  verde: '#22c55e',
  ambar: '#f59e0b',
  rojo:  '#ef4444',
  azul:  '#3b82f6',
}
