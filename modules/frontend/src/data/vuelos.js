export const VUELOS_EN_AIRE = [
  {
    codigo: 'FL-7519',
    desde: 'MEX',
    hasta: 'MAD',
    maletasActual: 131,
    maletasCapacidad: 180,
    tiempoVuelo: '9h 45m',
    horaDespegue: '10:30 AM',
    horaLlegada: '08:15 AM+1',
    estado: 'EN VUELO',
    progreso: 0.35,
  },
  {
    codigo: 'FL-4523',
    desde: 'HND',
    hasta: 'FRA',
    maletasActual: 198,
    maletasCapacidad: 210,
    tiempoVuelo: '12h 30m',
    horaDespegue: '12:00 PM',
    horaLlegada: '06:30 AM+1',
    estado: 'EN VUELO',
    progreso: 0.06,
  },
  {
    codigo: 'FL-3910',
    desde: 'GRU',
    hasta: 'DXB',
    maletasActual: 200,
    maletasCapacidad: 180,
    tiempoVuelo: '14h 00m',
    horaDespegue: '09:15 AM',
    horaLlegada: '11:15 PM',
    estado: 'EN VUELO',
    progreso: 0.24,
  },
  {
    codigo: 'FL-9012',
    desde: 'PEK',
    hasta: 'DXB',
    maletasActual: 165,
    maletasCapacidad: 220,
    tiempoVuelo: '8h 10m',
    horaDespegue: '09:00 AM',
    horaLlegada: '05:10 PM',
    estado: 'EN VUELO',
    progreso: 0.46,
  },
  {
    codigo: 'FL-8389',
    desde: 'GRU',
    hasta: 'FRA',
    maletasActual: 132,
    maletasCapacidad: 180,
    tiempoVuelo: '11h 20m',
    horaDespegue: '07:00 AM',
    horaLlegada: '06:20 PM',
    estado: 'EN VUELO',
    progreso: 0.53,
  },
  {
    codigo: 'FL-2461',
    desde: 'JFK',
    hasta: 'LHR',
    maletasActual: 45,
    maletasCapacidad: 200,
    tiempoVuelo: '7h 00m',
    horaDespegue: '03:00 PM',
    horaLlegada: '10:00 PM',
    estado: 'PRÓXIMO',
    progreso: 0,
  },
]

export const VUELOS_RANKING = [
  { codigo: 'FL-7519', desde: 'MEX', hasta: 'MAD', actual: 180, capacidad: 180, estado: 'EN AIRE', tiempo: 'En aire 2h 15m' },
  { codigo: 'FL-4523', desde: 'HND', hasta: 'FRA', actual: 198, capacidad: 210, estado: 'EN AIRE', tiempo: 'En aire 45m' },
  { codigo: 'FL-3148', desde: 'MEX', hasta: 'MAD', actual: 224, capacidad: 250, estado: 'PRÓXIMO', tiempo: 'Sale en 8h' },
  { codigo: 'FL-9012', desde: 'PEK', hasta: 'DXB', actual: 165, capacidad: 220, estado: 'EN AIRE', tiempo: 'En aire 3h 20m' },
  { codigo: 'FL-8389', desde: 'GRU', hasta: 'FRA', actual: 132, capacidad: 180, estado: 'EN AIRE', tiempo: 'En aire 5h 30m' },
  { codigo: 'FL-2461', desde: 'JFK', hasta: 'LHR', actual:  45, capacidad: 200, estado: 'PRÓXIMO', tiempo: 'Sale en 3h' },
]

export function getOcupacionVueloPct(vuelo) {
  return Math.round((vuelo.actual / vuelo.capacidad) * 100)
}

export function getSemaforoVuelo(pct) {
  if (pct >= 100) return { label: 'LLENO', color: 'rojo' }
  if (pct >= 85)  return { label: 'ALTO',  color: 'ambar' }
  if (pct >= 50)  return { label: 'ALTO',  color: 'ambar' }
  return { label: 'BAJO', color: 'azul' }
}
