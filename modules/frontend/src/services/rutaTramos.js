// Reconstrucción de los tramos de una ruta a partir de sus vuelos.
//
// Vive aparte de MapaMundi.jsx (donde estaba antes) por dos razones: es lógica
// pura, sin React ni Leaflet, y es la que decide las horas que el mapa anima —
// conviene poder probarla de forma aislada.
//
// Contexto: el backend entrega la ruta como una LISTA DE VUELOS, sin las horas
// de cada tramo, así que el mapa las reconstruye aquí a partir del horario de
// cada vuelo. Por eso las reglas de operación de las maletas tienen que estar
// también en este lado; si no, la animación puede mostrar algo que la
// planificación nunca habría aceptado.

/**
 * G05: tiempo mínimo que una maleta permanece en un aeropuerto intermedio entre
 * que aterriza un vuelo y despega el siguiente (transbordo).
 *
 * Debe coincidir con {@code TiemposOperacion.ESCALA_MINIMA} del backend. El
 * motor descarta las rutas que no lo cumplen; sin esta constante aquí, el mapa
 * podía dibujar conexiones de 1 minuto que la planificación nunca aceptó.
 */
export const ESCALA_MINIMA_MS = 10 * 60 * 1000

/**
 * G05: tiempo entre que la maleta aterriza en su destino final y el cliente la
 * recoge ({@code TiemposOperacion.RECOJO_DESTINO} del backend). Sirve para
 * mostrar la entrega efectiva, que es contra lo que se mide el plazo.
 */
export const RECOJO_DESTINO_MS = 15 * 60 * 1000

/**
 * Próxima fecha a las HH:mm que NO sea anterior a `afterDate` (permite la
 * igualdad).
 *
 * La comparación es `<` y no `<=` a propósito. Con `<=` se descartaba la
 * salida que caía justo en el instante límite y se saltaba al día siguiente,
 * lo que producía dos errores:
 *
 *  - Una conexión de exactamente la escala mínima se daba por imposible,
 *    cuando el backend sí la acepta ({@code RutaEnvio.esFactible} solo rechaza
 *    si la salida es ANTERIOR a llegada + escala mínima). El mapa quedaba más
 *    estricto que el planificador.
 *  - El primer tramo de toda ruta se corría un día. El `tiempoInicio` que
 *    manda el backend ES la salida del primer vuelo, así que la hora coincidía
 *    exactamente y siempre se empujaba al día siguiente.
 */
export function getNextDeparture(horaSalida, afterDate) {
  const [h, m] = horaSalida.split(':').map(Number)
  const d = new Date(afterDate)
  d.setHours(h, m, 0, 0)
  if (d < afterDate) d.setDate(d.getDate() + 1)
  return d
}

/**
 * Reconstruye los tramos de una ruta: { desde, hasta, salida, llegada, ... }.
 *
 * G05: en los aeropuertos de escala la siguiente salida no puede ser cualquier
 * hora posterior a la llegada — la maleta necesita ESCALA_MINIMA_MS en tierra
 * para el transbordo. En el aeropuerto de origen no aplica: la maleta ya está
 * en el almacén cuando arranca su ruta. Si el vuelo de conexión sale antes del
 * mínimo, se toma la siguiente ocurrencia de ese vuelo.
 *
 * Cada tramo lleva `esperaMin`: los minutos que la maleta pasa en tierra antes
 * de despegar (0 en el primer tramo), para poder mostrarlo en el plan de viaje.
 *
 * Si el backend ya trae `route.legs` (salida/llegada reales en UTC de la
 * instancia de vuelo que el algoritmo asignó — ver RouteResponse.LegResponse),
 * se usan tal cual y no se reconstruye nada. Solo se cae a la reconstrucción
 * de abajo para rutas persistidas ANTES de que existiera ese campo.
 */
function tieneHorasReales(route) {
  return Array.isArray(route.legs)
    && route.legs.length > 0
    && route.legs.every(l => l.salidaUtc && l.llegadaUtc)
}

function buildRouteLegsDesdeBackend(route, flightMap) {
  let llegadaPrevia = null
  return route.legs.flatMap(l => {
    const fid = l.flightBusinessId
    const flight = flightMap.get(fid)
    if (!flight) return []

    const salida = new Date(l.salidaUtc)
    const llegada = new Date(l.llegadaUtc)
    const esperaMin = llegadaPrevia
      ? Math.round((salida.getTime() - llegadaPrevia.getTime()) / 60000)
      : 0

    llegadaPrevia = llegada
    return [{
      flightBusinessId: fid,
      shipmentId: route.shipmentBusinessId,
      cantidadMaletas: route.cantidadMaletas ?? 0,
      desde: flight.origenIcao,
      hasta: flight.destinoIcao,
      salida,
      llegada,
      esperaMin,
      capacidadVuelo: flight.capacidad ?? 0,
    }]
  })
}

export function buildRouteLegs(route, flightMap) {
  if (tieneHorasReales(route)) {
    return buildRouteLegsDesdeBackend(route, flightMap)
  }

  let cursor = new Date(route.tiempoInicio)
  let llegadaPrevia = null
  return (route.flightBusinessIds ?? []).flatMap(fid => {
    const flight = flightMap.get(fid)
    if (!flight) return []

    // Tras una escala, la maleta no puede salir antes de llegada + permanencia mínima.
    const disponibleDesde = llegadaPrevia
      ? new Date(llegadaPrevia.getTime() + ESCALA_MINIMA_MS)
      : cursor

    const salida = getNextDeparture(flight.horaSalida, disponibleDesde)
    const llegada = new Date(salida.getTime() + flight.duracionMinutos * 60 * 1000)
    const esperaMin = llegadaPrevia
      ? Math.round((salida.getTime() - llegadaPrevia.getTime()) / 60000)
      : 0

    llegadaPrevia = llegada
    cursor = llegada
    return [{
      flightBusinessId: fid,
      shipmentId: route.shipmentBusinessId,
      cantidadMaletas: route.cantidadMaletas ?? 0,
      desde: flight.origenIcao,
      hasta: flight.destinoIcao,
      salida,
      llegada,
      esperaMin,
      capacidadVuelo: flight.capacidad ?? 0,
    }]
  })
}