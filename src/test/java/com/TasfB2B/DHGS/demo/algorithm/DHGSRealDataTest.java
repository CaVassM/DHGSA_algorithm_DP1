package com.TasfB2B.DHGS.demo.algorithm;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.DHGSAlgorithm;
import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.domain.model.Aeropuerto;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;
import com.TasfB2B.DHGS.demo.domain.model.Vuelo;
import com.TasfB2B.DHGS.demo.infraestructure.ingestion.AeropuertoParser;
import com.TasfB2B.DHGS.demo.infraestructure.ingestion.EnvioParser;
import com.TasfB2B.DHGS.demo.infraestructure.ingestion.VueloParser;
import com.TasfB2B.DHGS.demo.infraestructure.util.*;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Test de integración end-to-end con DATOS REALES:
 * 30 aeropuertos, 2866 vuelos, envíos reales (muestreo).
 *
 * Verifica que el algoritmo DHGS no se cae con datos de escala real
 * y que el fitness refleja correctamente costos y penalizaciones.
 */
@DisplayName("DHGS - Datos reales end-to-end")
class DHGSRealDataTest {

    private static Map<String, Aeropuerto> aeropuertosMap;
    private static List<Aeropuerto> aeropuertos;
    private static List<Vuelo> vuelos;
    private static List<Envio> enviosMuestra;       // Muestreo pequeño (~50)
    private static List<Envio> enviosMedios;        // Muestreo medio (~500)
    private static GrafoVuelos grafoVuelos;

    private static final AeropuertoParser aeropuertoParser = new AeropuertoParser();
    private static final VueloParser vueloParser = new VueloParser();
    private static final EnvioParser envioParser = new EnvioParser();

    @BeforeAll
    static void cargarDatosReales() throws Exception {
        Properties props = new Properties();
        try (InputStream is = DHGSRealDataTest.class
                .getClassLoader()
                .getResourceAsStream("test-ingestion.properties")) {
            assertNotNull(is, "No se encontró test-ingestion.properties");
            props.load(is);
        }

        // Cargar aeropuertos reales
        Path pathAeropuertos = getResourcePath(props.getProperty("real.data.aeropuertos"));
        aeropuertos = aeropuertoParser.parsear(pathAeropuertos);
        aeropuertosMap = aeropuertos.stream()
                .collect(Collectors.toMap(Aeropuerto::getCodigoICAO, a -> a));

        // Cargar vuelos reales
        Path pathVuelos = getResourcePath(props.getProperty("real.data.vuelos"));
        vuelos = vueloParser.parsear(pathVuelos, aeropuertosMap);

        // Cargar envíos reales (solo 2 archivos como muestreo)
        Path dirEnvios = getResourcePath(props.getProperty("real.data.envios.directorio"));
        List<Envio> todosEnviosMuestra = new ArrayList<>();
        try (Stream<Path> stream = Files.list(dirEnvios)) {
            List<Path> archivos = stream
                    .filter(p -> {
                        String n = p.getFileName().toString();
                        return n.endsWith(".txt") && n.startsWith("_envios_");
                    })
                    .sorted()
                    .limit(2)   // Solo 2 archivos para velocidad
                    .collect(Collectors.toList());

            for (Path archivo : archivos) {
                todosEnviosMuestra.addAll(envioParser.parsear(archivo, aeropuertosMap));
            }
        }

        // Muestreo pequeño: primeros 50 envíos
        enviosMuestra = todosEnviosMuestra.subList(0, Math.min(50, todosEnviosMuestra.size()));

        // Muestreo medio: primeros 500 envíos
        enviosMedios = todosEnviosMuestra.subList(0, Math.min(500, todosEnviosMuestra.size()));

        // Construir grafo
        grafoVuelos = new GrafoVuelos();
        grafoVuelos.construir(aeropuertos, vuelos);

        System.out.println("=================================================");
        System.out.println("   DATOS REALES CARGADOS PARA ALGORITMO         ");
        System.out.println("=================================================");
        System.out.printf("  Aeropuertos : %d%n", aeropuertos.size());
        System.out.printf("  Vuelos      : %d%n", vuelos.size());
        System.out.printf("  Envios pool : %d%n", todosEnviosMuestra.size());
        System.out.printf("  Muestra 50  : %d%n", enviosMuestra.size());
        System.out.printf("  Muestra 500 : %d%n", enviosMedios.size());
        System.out.printf("  Grafo       : %s%n", grafoVuelos);
        System.out.println("=================================================");
    }

    // =========================================================
    // TEST 1: Grafo real tiene conectividad amplia
    // =========================================================

    @Test
    @DisplayName("1. Grafo real: conectividad entre aeropuertos de envíos")
    void grafoRealConectividad() {
        int conexiones = 0;
        int sinConexion = 0;
        Set<String> paresSinConexion = new LinkedHashSet<>();

        for (Envio e : enviosMuestra) {
            boolean conectado = grafoVuelos.existeConexion(
                    e.getAeropuertoOrigen().getCodigoICAO(),
                    e.getAeropuertoDestino().getCodigoICAO());
            if (conectado) {
                conexiones++;
            } else {
                sinConexion++;
                paresSinConexion.add(e.getAeropuertoOrigen().getCodigoICAO()
                        + "→" + e.getAeropuertoDestino().getCodigoICAO());
            }
        }

        System.out.printf("%nConectividad real: %d con ruta, %d sin ruta de %d envios%n",
                conexiones, sinConexion, enviosMuestra.size());
        if (!paresSinConexion.isEmpty()) {
            System.out.println("Pares sin conexión directa: " + paresSinConexion);
        }

        assertTrue(conexiones > 0, "Debe haber al menos una conexión válida en datos reales");
        // Con 30 aeropuertos y 2866 vuelos, la mayoría debería estar conectada
        double ratioConexion = (double) conexiones / enviosMuestra.size();
        System.out.printf("Ratio de conectividad: %.1f%%%n", ratioConexion * 100);
    }

    // =========================================================
    // TEST 2: SPLIT funciona con datos reales
    // =========================================================

    @Test
    @DisplayName("2. SPLIT asigna rutas a envíos reales")
    void splitRealAsignaRutas() {
        AlgoritmoSPLIT split = new AlgoritmoSPLIT(grafoVuelos);

        int asignados = 0;
        int maxHops = 0;
        double distanciaMax = 0;

        for (Envio e : enviosMuestra) {
            RutaEnvio ruta = split.asignarMejorRuta(e);
            if (ruta != null) {
                asignados++;
                maxHops = Math.max(maxHops, ruta.getSecuenciaVuelos().size());
                distanciaMax = Math.max(distanciaMax, ruta.getDistanciaTotal());
            }
        }

        System.out.printf("%nSPLIT real: asigno %d/%d envios, maxHops=%d, maxDist=%.0f km%n",
                asignados, enviosMuestra.size(), maxHops, distanciaMax);

        assertTrue(asignados > 0, "SPLIT debe asignar al menos una ruta con datos reales");
    }

    // =========================================================
    // TEST 3: DHGS con 50 envíos reales (prueba rápida)
    // =========================================================

    @Test
    @DisplayName("3. DHGS con 50 envíos reales - no se cae y retorna fitness válido")
    void ejecutarDHGS50Envios() {
        AlgoritmoSPLIT split = new AlgoritmoSPLIT(grafoVuelos);
        CalculadorFitness fitness = new CalculadorFitness();
        Validador validador = new Validador();
        ConstructorSolucionesIniciales constructor = new ConstructorSolucionesIniciales(
                grafoVuelos, split, fitness);

        DHGSAlgorithm dhgs = new DHGSAlgorithm(constructor, split, fitness, validador);

        int epoca = 1;
        int totalEpocas = 1;
        int poblacion = 15;
        Duration limite = Duration.ofSeconds(5);

        System.out.println("\n--- DHGS 50 envios reales ---");

        long t0 = System.currentTimeMillis();
        Individuo resultado = dhgs.ejecutar(enviosMuestra, epoca, totalEpocas, poblacion, limite);
        long duracion = System.currentTimeMillis() - t0;

        // --- Verificaciones básicas ---
        assertNotNull(resultado, "DHGS debe retornar una solución con datos reales");
        assertNotNull(resultado.getEnviosAsignados(), "Debe tener envíos asignados");
        assertTrue(resultado.getFitness() < Double.MAX_VALUE, "Fitness debe ser finito");
        assertTrue(resultado.getFitness() > 0, "Fitness debe ser positivo");

        // --- Verificar que fitness refleja correctamente los componentes ---
        double costoDistancia = resultado.getCostoDistanciaTotal();
        double violCap = resultado.getViolacionesCapacidad();
        double violTime = resultado.getViolacionesTiempo();

        // Fitness >= costoDistancia (porque agrega penalizaciones)
        assertTrue(resultado.getFitness() >= costoDistancia,
                "Fitness debe ser >= costo distancia (penalizaciones suman)");

        // Si es factible, no debe haber violaciones
        if (resultado.isEsFactible()) {
            assertEquals(0.0, violCap, 0.001,
                    "Solución factible no debe tener violaciones de capacidad");
            assertEquals(0.0, violTime, 0.001,
                    "Solución factible no debe tener violaciones de tiempo");
        }

        // --- Reporte detallado ---
        imprimirResultado(resultado, duracion, "50 ENVÍOS REALES");

        // Validar con Validador
        List<String> violaciones = validador.validarIndividuo(resultado);
        System.out.println("\n=== VALIDACIÓN ===");
        if (violaciones.isEmpty()) {
            System.out.println("  ✓ Sin violaciones — solución completamente factible");
        } else {
            System.out.printf("  %d violaciones encontradas:%n", violaciones.size());
            violaciones.stream().limit(10).forEach(v -> System.out.println("  ⚠ " + v));
            if (violaciones.size() > 10) {
                System.out.printf("  ... y %d más%n", violaciones.size() - 10);
            }
        }
    }

    // =========================================================
    // TEST 4: DHGS con 500 envíos reales (carga media)
    // =========================================================

    @Test
    @DisplayName("4. DHGS con 200 envíos reales - escala media, fitness coherente")
    void ejecutarDHGS500Envios() {
        AlgoritmoSPLIT split = new AlgoritmoSPLIT(grafoVuelos);
        CalculadorFitness fitness = new CalculadorFitness();
        Validador validador = new Validador();
        ConstructorSolucionesIniciales constructor = new ConstructorSolucionesIniciales(
                grafoVuelos, split, fitness);

        DHGSAlgorithm dhgs = new DHGSAlgorithm(constructor, split, fitness, validador);

        // Tomar solo los primeros 200 envíos del pool medio
        List<Envio> envios200 = enviosMedios.subList(0, Math.min(200, enviosMedios.size()));

        int epoca = 1;
        int totalEpocas = 1;
        int poblacion = 15;
        Duration limite = Duration.ofSeconds(10);

        System.out.println("\n═══ DHGS 200 envíos reales ═══");

        long t0 = System.currentTimeMillis();
        Individuo resultado = dhgs.ejecutar(envios200, epoca, totalEpocas, poblacion, limite);
        long duracion = System.currentTimeMillis() - t0;

        // --- Verificaciones ---
        assertNotNull(resultado, "DHGS debe retornar solución con 200 envíos");
        assertTrue(resultado.getFitness() < Double.MAX_VALUE, "Fitness debe ser finito");
        assertTrue(resultado.getFitness() > 0, "Fitness debe ser positivo");

        int asignados = resultado.getEnviosAsignados().size();
        int noAsignados = resultado.getEnviosNoAsignados() != null
                ? resultado.getEnviosNoAsignados().size() : 0;

        // Con 500 envíos y buena conectividad, debería asignar una fracción significativa
        assertTrue(asignados > 0, "Debe asignar al menos un envío");
        System.out.printf("Ratio asignación: %d/%d = %.1f%%%n",
                asignados, asignados + noAsignados,
                100.0 * asignados / (asignados + noAsignados));

        // --- Coherencia del fitness ---
        // Con más envíos, el costo total debería ser mayor que con 50
        // (no verificamos directamente, pero imprimimos para revisión manual)

        imprimirResultado(resultado, duracion, "200 ENVÍOS REALES");

        // Verificar distribución de rutas por continente
        Map<String, Long> rutasPorContinente = resultado.getEnviosAsignados().entrySet().stream()
                .collect(Collectors.groupingBy(
                        e -> e.getKey().getAeropuertoOrigen().getContinente()
                             + "→" + e.getKey().getAeropuertoDestino().getContinente(),
                        Collectors.counting()));

        System.out.println("\n=== DISTRIBUCIÓN POR CONTINENTE ===");
        rutasPorContinente.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .forEach(e -> System.out.printf("  %s: %d envíos%n", e.getKey(), e.getValue()));
    }

    // =========================================================
    // TEST 5: Fitness es consistente — más envíos = mayor costo
    // =========================================================

    @Test
    @DisplayName("5. Fitness coherente: 50 vs 200 envíos — costo proporcional")
    void fitnessEsCoherente() {
        AlgoritmoSPLIT split = new AlgoritmoSPLIT(grafoVuelos);
        CalculadorFitness calc = new CalculadorFitness();
        Validador validador = new Validador();
        ConstructorSolucionesIniciales constructor = new ConstructorSolucionesIniciales(
                grafoVuelos, split, calc);

        // Solución greedy con 50 envíos
        Individuo sol50 = constructor.generarGreedy(enviosMuestra, 1, 1);
        // Solución greedy con 200 envíos
        List<Envio> envios200 = enviosMedios.subList(0, Math.min(200, enviosMedios.size()));
        Individuo sol200 = constructor.generarGreedy(envios200, 1, 1);

        System.out.println("\n═══ COMPARACIÓN FITNESS ═══");
        System.out.printf("  50  envíos: fitness=%.2f, asignados=%d, distancia=%.2f%n",
                sol50.getFitness(), sol50.getEnviosAsignados().size(), sol50.getCostoDistanciaTotal());
        System.out.printf("  200 envíos: fitness=%.2f, asignados=%d, distancia=%.2f%n",
                sol200.getFitness(), sol200.getEnviosAsignados().size(), sol200.getCostoDistanciaTotal());

        // Con más envíos asignados, el costo total debe ser mayor
        assertTrue(sol200.getCostoDistanciaTotal() >= sol50.getCostoDistanciaTotal(),
                "200 envíos debe tener costo distancia >= 50 envíos");

        // Fitness/envío debería ser razonablemente similar (misma red de vuelos)
        double fitnessPerEnvio50 = sol50.getFitness() / Math.max(1, sol50.getEnviosAsignados().size());
        double fitnessPerEnvio200 = sol200.getFitness() / Math.max(1, sol200.getEnviosAsignados().size());

        System.out.printf("  Fitness/envío 50:  %.2f%n", fitnessPerEnvio50);
        System.out.printf("  Fitness/envío 200: %.2f%n", fitnessPerEnvio200);

        // No debería diferir en más de un orden de magnitud
        assertTrue(fitnessPerEnvio200 < fitnessPerEnvio50 * 10,
                "Fitness por envío no debería diferir drásticamente entre escalas");
    }

    // =========================================================
    // Utilidades
    // =========================================================

    private void imprimirResultado(Individuo resultado, long duracion, String titulo) {
        int asignados = resultado.getEnviosAsignados().size();
        int noAsignados = resultado.getEnviosNoAsignados() != null
                ? resultado.getEnviosNoAsignados().size() : 0;

        System.out.println("\n╔══════════════════════════════════════════════════╗");
        System.out.printf("║  RESULTADO DHGS: %-31s ║%n", titulo);
        System.out.println("╠══════════════════════════════════════════════════╣");
        System.out.printf("║  Tiempo ejecución:    %-26d ms ║%n", duracion);
        System.out.printf("║  Envíos asignados:    %-26d    ║%n", asignados);
        System.out.printf("║  Envíos no asignados: %-26d    ║%n", noAsignados);
        System.out.printf("║  Fitness:             %-26.2f    ║%n", resultado.getFitness());
        System.out.printf("║  Costo distancia:     %-26.2f    ║%n", resultado.getCostoDistanciaTotal());
        System.out.printf("║  Viol. capacidad:     %-26.2f    ║%n", resultado.getViolacionesCapacidad());
        System.out.printf("║  Viol. tiempo:        %-26.2f    ║%n", resultado.getViolacionesTiempo());
        System.out.printf("║  Lateness:            %-26.2f    ║%n", resultado.getLateness());
        System.out.printf("║  Factible:            %-26s    ║%n", resultado.isEsFactible());
        System.out.println("╚══════════════════════════════════════════════════╝");

        // Mostrar top 5 rutas más costosas
        System.out.println("\n=== TOP 5 RUTAS MÁS COSTOSAS ===");
        resultado.getEnviosAsignados().entrySet().stream()
                .sorted((a, b) -> Double.compare(b.getValue().getCosto(), a.getValue().getCosto()))
                .limit(5)
                .forEach(entry -> {
                    Envio e = entry.getKey();
                    RutaEnvio r = entry.getValue();
                    String vuelosStr = r.getSecuenciaVuelos().stream()
                            .map(v -> v.getAeropuertoOrigen().getCodigoICAO() + "→"
                                    + v.getAeropuertoDestino().getCodigoICAO())
                            .collect(Collectors.joining(" → "));
                    System.out.printf("  [%s] %s→%s (%d maletas) vía: %s | costo=%.0f%n",
                            e.getId(),
                            e.getAeropuertoOrigen().getCodigoICAO(),
                            e.getAeropuertoDestino().getCodigoICAO(),
                            e.getCantidadMaletas(),
                            vuelosStr,
                            r.getCosto());
                });
    }

    private static Path getResourcePath(String relativePath) throws Exception {
        URL url = DHGSRealDataTest.class.getClassLoader().getResource(relativePath);
        assertNotNull(url, "Recurso no encontrado: " + relativePath);
        return Paths.get(url.toURI());
    }
}

