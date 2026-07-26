package com.tasfb2b.backend.service;

import com.tasfb2b.backend.domain.model.AirportEntity;
import com.tasfb2b.backend.dto.response.ImportSummaryResponse;
import com.tasfb2b.backend.repository.AirportRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Preparación y vuelta atrás del escenario "Operaciones día a día".
 *
 * <p>El enunciado pide dos cambios antes de la prueba y deshacerlos al acabar:
 * subir a 999 la capacidad de las cuatro sedes y añadir unos planes de vuelo
 * ajustados a la hora de la sesión. Ambos existen como SQL en
 * {@code scripts/preparar-dia-a-dia.sql}, pero eso obliga a tener acceso de
 * consola a la base del despliegue, que es justo lo que no se tiene el día de
 * la presentación — y el margen de preparación son 8 minutos.
 *
 * <p>Esta clase expone esa misma preparación por HTTP, para poder hacerla desde
 * el navegador contra el entorno desplegado. Los vuelos adicionales van por el
 * import que ya existe ({@code POST /api/v1/admin/imports/flights}); aquí solo
 * quedan las capacidades, que no tenían forma de cambiarse sin SQL.
 */
@Service
@RequiredArgsConstructor
public class DailyScenarioSetupService {

    private static final Logger log = LoggerFactory.getLogger(DailyScenarioSetupService.class);

    /**
     * Capacidad de almacén que el enunciado fija para las sedes durante la
     * prueba. Pública porque la pantalla de operación la usa para señalar si el
     * entorno está preparado, y tener el número en dos sitios se presta a que
     * uno se quede atrás.
     */
    public static final int CAPACIDAD_PRUEBA = 999;

    /**
     * Capacidades originales de las cuatro sedes, para la vuelta atrás. Están
     * en el enunciado ("se regresa la capacidad de los aeropuertos al estado
     * anterior SPIM:440, SABE:460, EKCH:480, VIDP:480").
     */
    private static final Map<String, Integer> CAPACIDADES_ORIGINALES = Map.of(
            "SPIM", 440,
            "SABE", 460,
            "EKCH", 480,
            "VIDP", 480
    );

    /** Las cuatro sedes, en el orden en que las nombra el enunciado. */
    public static final List<String> SEDES = List.of("SPIM", "SABE", "EKCH", "VIDP");

    /** Capacidad de los vuelos adicionales, según la plantilla del enunciado. */
    private static final int CAPACIDAD_VUELO_PRUEBA = 150;

    /** Los seis destinos sudamericanos de la plantilla. */
    private static final List<String> SUDAMERICA =
            List.of("SCEL", "SVMI", "SBBR", "SKBO", "SGAS", "SUAA");

    /** Los seis destinos de Europa-Asia de la plantilla. */
    private static final List<String> EUROPA_ASIA =
            List.of("EBCI", "LBSF", "OAKB", "OPKC", "EHAM", "OMDB");

    /**
     * Desplazamiento de cada vuelo dentro de su bloque: los dos primeros salen a
     * la hora de la prueba con minuto 12, los dos siguientes una hora más tarde
     * con minuto 13, y los dos últimos dos horas más tarde con minuto 14. Sale
     * de la plantilla del enunciado.
     */
    private static final int[][] OFFSETS = {
            {0, 12}, {0, 12}, {1, 13}, {1, 13}, {2, 14}, {2, 14}
    };

    private final AirportRepository airportRepository;
    private final DailyOperationService dailyOperationService;
    private final AdminImportService adminImportService;

    /** Capacidad de un aeropuerto antes y después del cambio. */
    public record CambioCapacidad(String icao, String ciudad, Integer anterior, Integer nueva) {}

    /** Resultado de preparar o revertir el escenario. */
    public record ResultadoPreparacion(
            boolean aplicado,
            String mensaje,
            List<CambioCapacidad> capacidades,
            List<String> avisos
    ) {}

    /**
     * Sube a 999 la capacidad de las cuatro sedes y reinicia la operación.
     *
     * <p>Es idempotente: repetirlo no rompe nada, solo informa de que ya
     * estaban puestas. Tras cambiar la BD hay que reiniciar el día a día, o el
     * grafo en memoria seguiría con las capacidades viejas.
     */
    @Transactional
    public ResultadoPreparacion preparar() {
        List<CambioCapacidad> cambios = new ArrayList<>();
        List<String> avisos = new ArrayList<>();

        for (String icao : SEDES) {
            AirportEntity aeropuerto = airportRepository.findByCodigoIcao(icao).orElse(null);
            if (aeropuerto == null) {
                avisos.add("No existe el aeropuerto " + icao + " en la base de datos.");
                continue;
            }

            Integer anterior = aeropuerto.getCapacidadAlmacen();
            if (anterior != null && anterior == CAPACIDAD_PRUEBA) {
                avisos.add(icao + " ya estaba en " + CAPACIDAD_PRUEBA + ".");
            }

            aeropuerto.setCapacidadAlmacen(CAPACIDAD_PRUEBA);
            airportRepository.save(aeropuerto);
            cambios.add(new CambioCapacidad(icao, aeropuerto.getCiudad(), anterior, CAPACIDAD_PRUEBA));
        }

        // El servicio mantiene el grafo en memoria: sin esto seguiría operando
        // con las capacidades anteriores.
        dailyOperationService.reiniciar();

        log.info("Día a día: escenario preparado — {} sedes a capacidad {}.",
                cambios.size(), CAPACIDAD_PRUEBA);

        return new ResultadoPreparacion(
                !cambios.isEmpty(),
                cambios.size() + " aeropuerto(s) a capacidad " + CAPACIDAD_PRUEBA
                        + ". Operación día a día reiniciada.",
                cambios,
                avisos);
    }

    /**
     * Devuelve las capacidades originales al terminar la prueba.
     *
     * <p>No borra los planes de vuelo añadidos: eso se hace con el SQL de
     * {@code scripts/preparar-dia-a-dia.sql}, que los distingue por capacidad
     * 150 y sede de origen.
     */
    @Transactional
    public ResultadoPreparacion revertir() {
        List<CambioCapacidad> cambios = new ArrayList<>();
        List<String> avisos = new ArrayList<>();

        for (String icao : SEDES) {
            AirportEntity aeropuerto = airportRepository.findByCodigoIcao(icao).orElse(null);
            if (aeropuerto == null) {
                avisos.add("No existe el aeropuerto " + icao + " en la base de datos.");
                continue;
            }

            Integer anterior = aeropuerto.getCapacidadAlmacen();
            int original = CAPACIDADES_ORIGINALES.get(icao);
            aeropuerto.setCapacidadAlmacen(original);
            airportRepository.save(aeropuerto);
            cambios.add(new CambioCapacidad(icao, aeropuerto.getCiudad(), anterior, original));
        }

        avisos.add("Los planes de vuelo añadidos NO se borran aquí; usa el bloque de vuelta"
                + " atrás de scripts/preparar-dia-a-dia.sql.");

        dailyOperationService.reiniciar();

        log.info("Día a día: escenario revertido — {} sedes a su capacidad original.", cambios.size());

        return new ResultadoPreparacion(
                !cambios.isEmpty(),
                cambios.size() + " aeropuerto(s) con su capacidad original. "
                        + "Operación día a día reiniciada.",
                cambios,
                avisos);
    }

    /** Un vuelo de la plantilla, ya con sus horas resueltas. */
    public record VueloGenerado(
            String linea,
            String origen,
            String destino,
            String horaSalida,
            String horaLlegada,
            int capacidad
    ) {}

    /** Resultado de generar (y quizá cargar) los vuelos adicionales. */
    public record ResultadoVuelos(
            boolean aplicado,
            String mensaje,
            String horaPrueba,
            int totalGenerados,
            int insertados,
            int actualizados,
            List<VueloGenerado> vuelos,
            List<String> avisos
    ) {}

    /**
     * Genera los planes de vuelo adicionales de la prueba a partir de la hora de
     * la presentación.
     *
     * <p>El enunciado no entrega un archivo: da una plantilla de 48 vuelos con
     * las horas marcadas como HO/HD y pide ajustarlas "según la hora de su
     * presentación". Como esa hora no se sabe hasta el día de la prueba, el
     * archivo no puede prepararse antes; de ahí que se genere aquí, a partir de
     * un solo dato.
     *
     * <p>Las horas van en hora local de cada aeropuerto, que es como está el
     * resto del fichero de planes de vuelo. La de llegada sale de la fórmula del
     * enunciado:
     *
     * <pre>HD = HO + duración + (gmt_destino - gmt_origen)</pre>
     *
     * <p>Se comprueba contra los vuelos reales del dataset: SPIM→SVMI va de
     * 05:24 a 09:50 (4h26 = 3h26 de vuelo + 1h de huso) y SPIM→EBCI de 08:07 a
     * 04:11 (20h04 = 13h de vuelo + 7h de huso). Restar las dos horas sin
     * ajustar nada —que es lo que hace VueloParser— da duración más diferencia
     * de husos, justo lo que el modelo necesita.
     *
     * @param horaPrueba hora de inicio de la prueba en hora local de Lima, "HH:mm"
     * @param persistir  si false, solo devuelve las líneas para revisarlas antes
     *                   de cargarlas (el enunciado pide presentar el archivo
     *                   antes de agregarlo)
     */
    @Transactional
    public ResultadoVuelos generarVuelosAdicionales(String horaPrueba, boolean persistir) {
        int horaLima;
        try {
            String[] partes = horaPrueba.trim().split(":");
            horaLima = Integer.parseInt(partes[0].trim());
            if (horaLima < 0 || horaLima > 23) {
                throw new NumberFormatException();
            }
        } catch (RuntimeException e) {
            throw new IllegalArgumentException(
                    "Hora inválida: '" + horaPrueba + "'. Se espera HH:mm en 24 h, por ejemplo 11:00.");
        }

        Map<String, AirportEntity> porIcao = new LinkedHashMap<>();
        for (AirportEntity a : airportRepository.findAll()) {
            porIcao.put(a.getCodigoIcao(), a);
        }

        List<String> avisos = new ArrayList<>();
        List<VueloGenerado> generados = new ArrayList<>();
        StringBuilder archivo = new StringBuilder();

        // Los ocho bloques del enunciado: para SPIM y SABE, 6 h dentro de
        // Sudamérica y 12 h fuera; para EKCH y VIDP, 4 h dentro de Europa-Asia y
        // 13 h fuera.
        for (String sede : SEDES) {
            boolean esSudamericana = sede.equals("SPIM") || sede.equals("SABE");
            List<String> dentro = esSudamericana ? SUDAMERICA : EUROPA_ASIA;
            List<String> fuera = esSudamericana ? EUROPA_ASIA : SUDAMERICA;
            int duracionDentro = esSudamericana ? 6 : 4;
            int duracionFuera = esSudamericana ? 12 : 13;

            AirportEntity origen = porIcao.get(sede);
            if (origen == null) {
                avisos.add("No existe la sede " + sede + "; se omiten sus vuelos.");
                continue;
            }

            for (int bloque = 0; bloque < 2; bloque++) {
                List<String> destinos = bloque == 0 ? dentro : fuera;
                int duracion = bloque == 0 ? duracionDentro : duracionFuera;

                for (int i = 0; i < destinos.size(); i++) {
                    String icaoDestino = destinos.get(i);
                    AirportEntity destino = porIcao.get(icaoDestino);
                    if (destino == null) {
                        avisos.add("No existe el destino " + icaoDestino + "; se omite.");
                        continue;
                    }

                    int saltoHoras = OFFSETS[i][0];
                    int minuto = OFFSETS[i][1];

                    // La prueba empieza a la misma hora física en las cuatro
                    // sedes, así que la hora local de salida se traslada desde
                    // la de Lima con la diferencia de husos.
                    int ho = Math.floorMod(
                            horaLima + saltoHoras + (origen.getGmt() - porIcao.get("SPIM").getGmt()), 24);
                    int hd = Math.floorMod(ho + duracion + (destino.getGmt() - origen.getGmt()), 24);

                    String linea = String.format("%s-%s-%02d:%02d-%02d:%02d-%04d",
                            sede, icaoDestino, ho, minuto, hd, minuto, CAPACIDAD_VUELO_PRUEBA);

                    generados.add(new VueloGenerado(linea, sede, icaoDestino,
                            String.format("%02d:%02d", ho, minuto),
                            String.format("%02d:%02d", hd, minuto),
                            CAPACIDAD_VUELO_PRUEBA));
                    archivo.append(linea).append('\n');
                }
            }
        }

        if (!persistir) {
            return new ResultadoVuelos(false,
                    generados.size() + " vuelos generados para una prueba a las " + horaPrueba
                            + " (hora de Lima). Revísalos y vuelve a llamar con persistir=true"
                            + " para cargarlos.",
                    horaPrueba, generados.size(), 0, 0, generados, avisos);
        }

        // Se reutiliza el import de siempre: hace upsert por businessId y deja
        // intactos los vuelos existentes.
        ImportSummaryResponse resumen = adminImportService.importFlightsFromText(archivo.toString());

        // El grafo vive en memoria; sin esto la operación no vería los vuelos.
        dailyOperationService.reiniciar();

        log.info("Día a día: {} vuelos adicionales generados para las {} — {} nuevos, {} actualizados.",
                generados.size(), horaPrueba, resumen.insertedCount(), resumen.updatedCount());

        return new ResultadoVuelos(true,
                resumen.insertedCount() + " vuelos añadidos y " + resumen.updatedCount()
                        + " actualizados. Operación día a día reiniciada.",
                horaPrueba, generados.size(),
                resumen.insertedCount(), resumen.updatedCount(),
                generados, avisos);
    }

    /**
     * Capacidades actuales de las cuatro sedes, para comprobar de un vistazo si
     * el entorno está preparado (es lo que se enseña en la fase de preparación
     * de la prueba).
     */
    @Transactional(readOnly = true)
    public Map<String, Object> estadoPreparacion() {
        List<CambioCapacidad> actuales = new ArrayList<>();
        boolean preparado = true;

        for (String icao : SEDES) {
            AirportEntity aeropuerto = airportRepository.findByCodigoIcao(icao).orElse(null);
            if (aeropuerto == null) {
                preparado = false;
                continue;
            }
            Integer capacidad = aeropuerto.getCapacidadAlmacen();
            actuales.add(new CambioCapacidad(icao, aeropuerto.getCiudad(), capacidad, capacidad));
            if (capacidad == null || capacidad != CAPACIDAD_PRUEBA) {
                preparado = false;
            }
        }

        Map<String, Object> respuesta = new LinkedHashMap<>();
        respuesta.put("preparado", preparado);
        respuesta.put("capacidadEsperada", CAPACIDAD_PRUEBA);
        respuesta.put("sedes", actuales);
        return respuesta;
    }
}
