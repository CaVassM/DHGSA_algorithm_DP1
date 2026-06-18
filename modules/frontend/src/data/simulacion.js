export const SIMULACION = {
  diaActual: 3,
  diasTotal: 5,
  horaSimulada: '12:45 PM (Día 3)',
  tiempoEjecucionMin: 45,
  tiempoTotalMin: 60,
  terminaEn: '15 minutos',
  algoritmo: 'Genético (AG)',
}

export const KPIS = {
  maletasTransito: 2845,
  maletasPendientes: 3120,
  maletasEntregadas: 14520,
  cumplimientoPlazos: 87.5,
}

export const LOG_EVENTOS = [
  {
    hora: '12:45',
    tipo: 'info',
    mensaje: 'VUELO FL-7519: Despegó de MEX → MAD, 131/180 maletas (73%)',
  },
  {
    hora: '12:43',
    tipo: 'critico',
    mensaje: 'ALMACÉN CRÍTICO: LHR alcanzó 950/1000 (95%) → Acción sugerida: redirigir a FRA o MAD',
  },
  {
    hora: '12:40',
    tipo: 'alerta',
    mensaje: 'ALERTA MALETA TB2B-E1048Y (MEX→FRA): 4h restantes para incumplir plazo',
  },
  {
    hora: '12:38',
    tipo: 'exito',
    mensaje: 'DESPACHO COMPLETO: FL-290 entregó 224 maletas en PEK',
  },
  {
    hora: '12:30',
    tipo: 'alerta',
    mensaje: 'ALERTA MALETA TB2B-578WX0 (GRU→LHR): Fuera de plazo (-4h)',
  },
  {
    hora: '12:25',
    tipo: 'info',
    mensaje: 'VUELO FL-4523: En ruta HND → FRA, 198/210 maletas (94%)',
  },
  {
    hora: '12:20',
    tipo: 'exito',
    mensaje: 'ASIGNACIÓN: 89 maletas asignadas a FL-9744 desde GRU',
  },
]

export const ATENCION_REQUERIDA = [
  {
    codigo: 'HND',
    nivel: 'critico',
    mensaje: 'Almacén 86.4%, ~2h para colapso',
  },
  {
    codigo: 'MEX',
    nivel: 'vigilar',
    mensaje: 'Almacén 84.8%',
  },
  {
    codigo: 'GRU',
    nivel: 'vigilar',
    mensaje: 'Almacén 63.3%',
  },
]

export const DATOS_GRAFICO_DIAS = [
  { dia: 'Día 1', procesadas: 3200, capacidad: 4500 },
  { dia: 'Día 2', procesadas: 3800, capacidad: 4500 },
  { dia: 'Día 3', procesadas: 4100, capacidad: 4500 },
  { dia: 'Día 4', procesadas: 3600, capacidad: 4500 },
  { dia: 'Día 5', procesadas: 2800, capacidad: 4500 },
]

export const CONTINENTES = [
  {
    nombre: 'América',
    maletasProcesadas: 6500,
    cumplimiento: 89,
    almacenesCriticos: ['MEX', 'GRU'],
  },
  {
    nombre: 'Europa',
    maletasProcesadas: 8200,
    cumplimiento: 85,
    almacenesCriticos: ['LHR', 'FRA'],
  },
  {
    nombre: 'Asia',
    maletasProcesadas: 5800,
    cumplimiento: 88,
    almacenesCriticos: ['PEK', 'HND'],
  },
]
