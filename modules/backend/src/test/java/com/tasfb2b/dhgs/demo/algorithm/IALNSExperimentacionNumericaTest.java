package com.tasfb2b.dhgs.demo.algorithm;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.algorithm.ialns.IALNSAlgorithm;
import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import com.tasfb2b.dhgs.demo.domain.service.EpocaData;
import com.tasfb2b.dhgs.demo.domain.service.SimuladorEpocas;
import com.tasfb2b.dhgs.demo.infraestructure.ingestion.AeropuertoParser;
import com.tasfb2b.dhgs.demo.infraestructure.ingestion.EnvioParser;
import com.tasfb2b.dhgs.demo.infraestructure.ingestion.VueloParser;
import com.tasfb2b.dhgs.demo.infraestructure.util.AlgoritmoSPLIT;
import com.tasfb2b.dhgs.demo.infraestructure.util.CalculadorFitness;
import com.tasfb2b.dhgs.demo.infraestructure.util.ConstructorSolucionesIniciales;
import com.tasfb2b.dhgs.demo.infraestructure.util.GrafoVuelos;
import com.tasfb2b.dhgs.demo.infraestructure.util.Validador;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DisplayName("Experimentación numérica IALNS - escenarios de 3, 5 y 7 días")
@Tag("slow-experiment")
class IALNSExperimentacionNumericaTest {

    private static final AeropuertoParser aeropuertoParser = new AeropuertoParser();
    private static final VueloParser vueloParser = new VueloParser();
    private static final EnvioParser envioParser = new EnvioParser();

    private static Properties ingestionProps;
    private static Properties experimentProps;
    private static LocalDateTime inicioSimulacion;
    private static long duracionEpocaHoras;
    private static int tamanoPoblacion;
    private static Duration limitePorEpoca;

    private static List<Aeropuerto> aeropuertos;
    private static Map<String, Aeropuerto> aeropuertosMap;
    private static List<Vuelo> vuelos;
    private static List<Envio> enviosVentanaMaxima;

    @BeforeAll
    static void cargarContextoComun() throws Exception {
        ingestionProps = cargarProperties("test-ingestion.properties");
        experimentProps = cargarProperties("test-experiment.properties");

        inicioSimulacion = LocalDateTime.parse(prop("experiment.start"));
        duracionEpocaHoras = Long.parseLong(prop("experiment.epoch.hours"));
        tamanoPoblacion = Integer.parseInt(prop("experiment.population"));
        limitePorEpoca = Duration.ofSeconds(Long.parseLong(prop("experiment.time.limit.seconds")));

        Path pathAeropuertos = getResourcePath(ingestionProps.getProperty("real.data.aeropuertos"));
        aeropuertos = aeropuertoParser.parsear(pathAeropuertos);
        aeropuertosMap = aeropuertos.stream()
                .collect(Collectors.toMap(Aeropuerto::getCodigoICAO, a -> a));

        Path pathVuelos = getResourcePath(ingestionProps.getProperty("real.data.vuelos"));
        vuelos = vueloParser.parsear(pathVuelos, aeropuertosMap);

        int maxDias = Stream.of("3", "5", "7")
                .mapToInt(id -> Integer.parseInt(prop("experiment.scenario." + id + ".days")))
                .max()
                .orElseThrow();

        enviosVentanaMaxima = cargarEnviosEnVentana(inicioSimulacion, maxDias);
    }

    @Test
    @DisplayName("1. Escenario numérico de 3 días")
    void escenarioTresDias() {
        ejecutarEscenario("3");
    }

    @Test
    @DisplayName("2. Escenario numérico de 5 días")
    void escenarioCincoDias() {
        ejecutarEscenario("5");
    }

    @Test
    @DisplayName("3. Escenario numérico de 7 días")
    void escenarioSieteDias() {
        ejecutarEscenario("7");
    }

    private void ejecutarEscenario(String escenarioId) {
        int dias = Integer.parseInt(prop("experiment.scenario." + escenarioId + ".days"));
        int esperados = Integer.parseInt(prop("experiment.scenario." + escenarioId + ".expectedShipments"));
        LocalDateTime finExclusivo = inicioSimulacion.plusDays(dias);

        long tInicioEscenario = System.currentTimeMillis();
        List<Envio> enviosEscenario = copiarEnvios(
                enviosVentanaMaxima.stream()
                        .filter(envio -> !envio.getFechaHoraCreacion().isBefore(inicioSimulacion)
                                && envio.getFechaHoraCreacion().isBefore(finExclusivo))
                        .sorted(Comparator.comparing(Envio::getFechaHoraCreacion).thenComparing(Envio::getId))
                        .collect(Collectors.toCollection(ArrayList::new))
        );
        long tFinFiltrado = System.currentTimeMillis();

        assertEquals(esperados, enviosEscenario.size(),
                "El escenario de " + dias + " días debe contener el total esperado de envíos");
        assertFalse(enviosEscenario.isEmpty(), "El escenario no debe quedar vacío");
        assertTrue(enviosEscenario.stream().allMatch(envio -> !envio.getFechaHoraCreacion().isBefore(inicioSimulacion)
                && envio.getFechaHoraCreacion().isBefore(finExclusivo)),
            "Todos los envíos deben caer dentro de la ventana configurada");

        Map<LocalDate, Long> enviosPorDia = enviosEscenario.stream()
                .collect(Collectors.groupingBy(envio -> envio.getFechaHoraCreacion().toLocalDate(),
                        LinkedHashMap::new,
                        Collectors.counting()));
        long sumaPorDia = enviosPorDia.values().stream().mapToLong(Long::longValue).sum();
        assertEquals(enviosEscenario.size(), sumaPorDia,
            "La suma agrupada por día debe coincidir con el total del escenario");

        GrafoVuelos grafo = new GrafoVuelos();
        grafo.construir(aeropuertos, vuelos, inicioSimulacion.toLocalDate(), dias);

        CalculadorFitness fitness = new CalculadorFitness();
        AlgoritmoSPLIT split = new AlgoritmoSPLIT(grafo);
        ConstructorSolucionesIniciales constructor = new ConstructorSolucionesIniciales(grafo, split, fitness);
        Validador validador = new Validador();
        IALNSAlgorithm ialns = new IALNSAlgorithm(constructor, split, fitness, validador);
        SimuladorEpocas simulador = new SimuladorEpocas();

        List<EpocaData> epocas = simulador.organizarEnEpocas(
                enviosEscenario,
                aeropuertos,
                inicioSimulacion,
                duracionEpocaHoras,
                dias);

        assertEquals(dias * 6, epocas.size(),
                "Cada día debe aportar 6 épocas de 4 horas");
        assertEquals(inicioSimulacion, epocas.getFirst().getInicio());
        assertEquals(inicioSimulacion.plusHours(duracionEpocaHoras), epocas.getFirst().getFin());

        List<Envio> pendientes = new ArrayList<>();
        Set<String> enviosDespachados = new LinkedHashSet<>();
        int totalMaletas = 0;

        for (EpocaData epoca : epocas) {
            simulador.prepararEpoca(epoca, pendientes);
            List<Envio> enviosEpoca = epoca.getTodosLosEnvios();

            if (enviosEpoca.isEmpty()) {
                pendientes = new ArrayList<>();
                continue;
            }

            Individuo mejor = ialns.ejecutar(
                    enviosEpoca,
                    epoca.getNumeroEpoca(),
                    epocas.size(),
                    tamanoPoblacion,
                    limitePorEpoca);

                if (mejor != null) {
                List<String> violaciones = validador.validarIndividuo(mejor);
                assertTrue(violaciones.isEmpty(),
                    "La solución por época debe ser válida en el escenario ideal. Violaciones: " + violaciones);
                assertNotNull(mejor.getRepresentacionGigante(), "Cada solución debe mantener un giant tour");
                assertTrue(mejor.getRepresentacionGigante().containsAll(mejor.getEnviosAsignados().keySet()),
                    "Todo envío asignado debe pertenecer a la representación gigante de la época");
                }

            pendientes = simulador.finalizarEpoca(epoca, mejor);
            if (epoca.getEnviosDespachados() != null) {
                for (Envio envio : epoca.getEnviosDespachados()) {
                    String claveEnvio = claveEnvio(envio);
                    assertTrue(enviosDespachados.add(claveEnvio),
                            "Un envío no debe despacharse más de una vez: " + claveEnvio);
                    totalMaletas += envio.getCantidadMaletas();
                }
            }
        }

        Set<String> enviosPendientes = pendientes.stream()
                .map(IALNSExperimentacionNumericaTest::claveEnvio)
                .collect(Collectors.toSet());
        enviosPendientes.forEach(id -> assertFalse(enviosDespachados.contains(id),
            "Un envío pendiente no puede figurar también como despachado: " + id));
        assertEquals(enviosEscenario.size(), enviosDespachados.size() + enviosPendientes.size(),
                "Todos los envíos del escenario deben terminar despachados o pendientes al cierre");
        assertFalse(enviosDespachados.isEmpty(), "El escenario debe despachar al menos un envío");
        assertTrue(totalMaletas > 0, "El escenario debe mover maletas reales");
        assertTrue(simulador.getCostoAcumulado() > 0.0, "El escenario debe acumular costo positivo");

        long tFinEscenario = System.currentTimeMillis();
        imprimirResumenEscenario(
                escenarioId,
                dias,
                enviosEscenario.size(),
                enviosPorDia,
                epocas.size(),
                enviosDespachados.size(),
                pendientes.size(),
                totalMaletas,
                simulador.getCostoAcumulado(),
                tFinFiltrado - tInicioEscenario,
                tFinEscenario - tFinFiltrado,
                tFinEscenario - tInicioEscenario
        );
    }

    private static List<Envio> cargarEnviosEnVentana(LocalDateTime inicio, int dias) throws Exception {
        Path dirEnvios = getResourcePath(ingestionProps.getProperty("real.data.envios.directorio"));
        LocalDateTime finExclusivo = inicio.plusDays(dias);
        List<Envio> envios = new ArrayList<>();

        try (Stream<Path> stream = Files.list(dirEnvios)) {
            List<Path> archivos = stream
                    .filter(p -> {
                        String nombre = p.getFileName().toString();
                        return nombre.endsWith(".txt") && nombre.startsWith("_envios_");
                    })
                    .sorted()
                    .toList();

            for (Path archivo : archivos) {
                List<Envio> enviosArchivo = envioParser.parsear(archivo, aeropuertosMap);
                enviosArchivo.stream()
                        .filter(envio -> envio.getFechaHoraCreacion() != null)
                        .filter(envio -> !envio.getFechaHoraCreacion().isBefore(inicio)
                                && envio.getFechaHoraCreacion().isBefore(finExclusivo))
                        .forEach(envios::add);
            }
        }

        return envios.stream()
                .sorted(Comparator.comparing(Envio::getFechaHoraCreacion).thenComparing(Envio::getId))
                .collect(Collectors.toCollection(ArrayList::new));
    }

    private static List<Envio> copiarEnvios(List<Envio> originales) {
        List<Envio> copias = new ArrayList<>(originales.size());
        for (Envio original : originales) {
            Envio copia = new Envio();
            copia.setId(original.getId());
            copia.setAeropuertoOrigen(original.getAeropuertoOrigen());
            copia.setAeropuertoDestino(original.getAeropuertoDestino());
            copia.setFechaHoraCreacion(original.getFechaHoraCreacion());
            copia.setCantidadMaletas(original.getCantidadMaletas());
            copia.setIdCliente(original.getIdCliente());
            copia.setDeadline(original.getDeadline());
            copia.setEsMustGo(original.isEsMustGo());
            copia.setPrioridad(original.getPrioridad());
            copias.add(copia);
        }
        return copias;
    }

    private static String claveEnvio(Envio envio) {
        String origen = envio.getAeropuertoOrigen() != null ? envio.getAeropuertoOrigen().getCodigoICAO() : "NULL";
        String destino = envio.getAeropuertoDestino() != null ? envio.getAeropuertoDestino().getCodigoICAO() : "NULL";
        String fecha = envio.getFechaHoraCreacion() != null ? envio.getFechaHoraCreacion().toString() : "NULL";
        return envio.getId() + "|" + origen + "|" + destino + "|" + fecha;
    }

    private static void imprimirResumenEscenario(String escenarioId,
                                                 int dias,
                                                 int totalEnvios,
                                                 Map<LocalDate, Long> enviosPorDia,
                                                 int totalEpocas,
                                                 int totalDespachados,
                                                 int totalPendientes,
                                                 int totalMaletas,
                                                 double costoAcumulado,
                                                 long msFiltrado,
                                                 long msSimulacion,
                                                 long msTotal) {
        double porcentajeDespachados = calcularPorcentaje(totalDespachados, totalEnvios);
        double porcentajePendientes = calcularPorcentaje(totalPendientes, totalEnvios);

        System.out.println("\n=== EXPERIMENTACIÓN NUMÉRICA IALNS ===");
        System.out.printf("Escenario: %s días%n", dias);
        System.out.printf("ID escenario: %s%n", escenarioId);
        System.out.printf("Inicio simulación: %s%n", inicioSimulacion);
        System.out.printf("Épocas: %d%n", totalEpocas);
        System.out.printf("Envíos en ventana: %d%n", totalEnvios);
        System.out.printf("Envíos asignados/despachados: %d/%d (%s)%n",
                totalDespachados,
                totalEnvios,
                formatearPorcentaje(porcentajeDespachados));
        System.out.printf("Envíos pendientes/no asignados: %d/%d (%s)%n",
                totalPendientes,
                totalEnvios,
                formatearPorcentaje(porcentajePendientes));
        System.out.printf("Maletas despachadas: %d%n", totalMaletas);
        System.out.printf("Costo acumulado: %.2f%n", costoAcumulado);
        System.out.printf("Tiempo filtrado/carga: %s%n", formatearDuracionMs(msFiltrado));
        System.out.printf("Tiempo simulación: %s%n", formatearDuracionMs(msSimulacion));
        System.out.printf("Tiempo total escenario: %s%n", formatearDuracionMs(msTotal));
        System.out.println("Distribución por día:");
        enviosPorDia.forEach((dia, cantidad) -> System.out.printf("  %s -> %d envíos%n", dia, cantidad));
    }

    private static double calcularPorcentaje(int valor, int total) {
        if (total <= 0) {
            return 0.0;
        }
        return (valor * 100.0) / total;
    }

    private static String formatearPorcentaje(double porcentaje) {
        return String.format(Locale.US, "%.2f%%", porcentaje);
    }

    private static String formatearDuracionMs(long ms) {
        if (ms < 1000) {
            return String.format(Locale.US, "%d ms", ms);
        }
        return String.format(Locale.US, "%,d ms (%.3f s)", ms, ms / 1000.0);
    }

    private static Properties cargarProperties(String resourceName) throws Exception {
        Properties props = new Properties();
        try (InputStream is = IALNSExperimentacionNumericaTest.class.getClassLoader().getResourceAsStream(resourceName)) {
            assertNotNull(is, "No se encontró " + resourceName);
            props.load(is);
        }
        return props;
    }

    private static String prop(String key) {
        String value = experimentProps.getProperty(key);
        assertNotNull(value, "Propiedad no definida: " + key);
        return value;
    }

    private static Path getResourcePath(String relativePath) throws Exception {
        URL url = IALNSExperimentacionNumericaTest.class.getClassLoader().getResource(relativePath);
        assertNotNull(url, "Recurso no encontrado: " + relativePath);
        return Paths.get(url.toURI());
    }
}