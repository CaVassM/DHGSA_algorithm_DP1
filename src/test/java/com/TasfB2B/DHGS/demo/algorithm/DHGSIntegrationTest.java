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
 * Test de integración end-to-end:
 * Carga datos → Construye grafo → Ejecuta DHGS → Verifica resultado.
 *
 * Simula una ejecución completa del algoritmo con los datos de prueba.
 */
@DisplayName("DHGS - Simulación completa end-to-end")
class DHGSIntegrationTest {

    private static Map<String, Aeropuerto> aeropuertosMap;
    private static List<Aeropuerto> aeropuertos;
    private static List<Vuelo> vuelos;
    private static List<Envio> envios;
    private static GrafoVuelos grafoVuelos;

    // Parsers
    private static final AeropuertoParser aeropuertoParser = new AeropuertoParser();
    private static final VueloParser vueloParser = new VueloParser();
    private static final EnvioParser envioParser = new EnvioParser();

    @BeforeAll
    static void cargarDatos() throws Exception {
        Properties props = new Properties();
        try (InputStream is = DHGSIntegrationTest.class
                .getClassLoader()
                .getResourceAsStream("test-ingestion.properties")) {
            assertNotNull(is, "No se encontró test-ingestion.properties");
            props.load(is);
        }

        // Cargar aeropuertos
        Path pathAeropuertos = getResourcePath(props.getProperty("test.data.aeropuertos"));
        aeropuertos = aeropuertoParser.parsear(pathAeropuertos);
        aeropuertosMap = aeropuertos.stream()
                .collect(Collectors.toMap(Aeropuerto::getCodigoICAO, a -> a));

        // Cargar vuelos
        Path pathVuelos = getResourcePath(props.getProperty("test.data.vuelos"));
        vuelos = vueloParser.parsear(pathVuelos, aeropuertosMap);

        // Cargar envíos
        Path dirEnvios = getResourcePath(props.getProperty("test.data.envios.directorio"));
        envios = new ArrayList<>();
        try (Stream<Path> stream = Files.list(dirEnvios)) {
            stream.filter(p -> p.getFileName().toString().startsWith("envios_")
                            && p.getFileName().toString().endsWith(".txt"))
                    .sorted()
                    .forEach(archivo -> envios.addAll(envioParser.parsear(archivo, aeropuertosMap)));
        }

        // Construir grafo
        grafoVuelos = new GrafoVuelos();
        grafoVuelos.construir(aeropuertos, vuelos);

        System.out.println("=================================================");
        System.out.println("   DATOS CARGADOS PARA INTEGRACION              ");
        System.out.println("=================================================");
        System.out.printf("  Aeropuertos : %d%n", aeropuertos.size());
        System.out.printf("  Vuelos      : %d%n", vuelos.size());
        System.out.printf("  Envios      : %d%n", envios.size());
        System.out.printf("  Grafo       : %s%n", grafoVuelos);
        System.out.println("=================================================");
    }

    @Test
    @DisplayName("1. Grafo de vuelos tiene conectividad válida")
    void grafoTieneConectividad() {
        // Verificar que existen rutas entre los pares origen-destino de los envíos
        int conexiones = 0;
        int sinConexion = 0;

        for (Envio e : envios) {
            boolean conectado = grafoVuelos.existeConexion(
                    e.getAeropuertoOrigen().getCodigoICAO(),
                    e.getAeropuertoDestino().getCodigoICAO());
            if (conectado) conexiones++;
            else sinConexion++;
        }

        System.out.printf("%nConectividad: %d con ruta, %d sin ruta%n", conexiones, sinConexion);
        assertTrue(conexiones > 0, "Debe haber al menos una conexión válida");
    }

    @Test
    @DisplayName("2. SPLIT asigna rutas a envíos individuales")
    void splitAsignaRutas() {
        AlgoritmoSPLIT split = new AlgoritmoSPLIT(grafoVuelos);

        int asignados = 0;
        for (Envio e : envios) {
            RutaEnvio ruta = split.asignarMejorRuta(e);
            if (ruta != null) {
                asignados++;
                System.out.printf("  %s→%s: %d vuelos, dist=%.0f km%n",
                        e.getAeropuertoOrigen().getCodigoICAO(),
                        e.getAeropuertoDestino().getCodigoICAO(),
                        ruta.getSecuenciaVuelos().size(),
                        ruta.getDistanciaTotal());
            }
        }

        System.out.printf("%nSPLIT asignó ruta a %d/%d envíos%n", asignados, envios.size());
        assertTrue(asignados > 0, "SPLIT debe asignar al menos una ruta");
    }

    @Test
    @DisplayName("3. Ejecución completa del algoritmo DHGS")
    void ejecutarDHGSCompleto() {
        // Instanciar componentes
        AlgoritmoSPLIT split = new AlgoritmoSPLIT(grafoVuelos);
        CalculadorFitness fitness = new CalculadorFitness();
        Validador validador = new Validador();
        ConstructorSolucionesIniciales constructor = new ConstructorSolucionesIniciales(
                grafoVuelos, split, fitness);

        // Instanciar algoritmo
        DHGSAlgorithm dhgs = new DHGSAlgorithm(constructor, split, fitness, validador);

        // Ejecutar
        int epoca = 1;
        int totalEpocas = 1;
        int poblacion = 25;
        Duration limite = Duration.ofSeconds(10);

        System.out.println("\n=================================================");
        System.out.println("           EJECUTANDO DHGS                       ");
        System.out.printf( "  Epoca: %d/%d | Poblacion: %d | Limite: %ds%n",
                epoca, totalEpocas, poblacion, limite.getSeconds());
        System.out.println("=================================================\n");

        long t0 = System.currentTimeMillis();
        Individuo resultado = dhgs.ejecutar(envios, epoca, totalEpocas, poblacion, limite);
        long duracion = System.currentTimeMillis() - t0;

        // --- Verificaciones ---
        assertNotNull(resultado, "DHGS debe retornar una solución");
        assertNotNull(resultado.getEnviosAsignados(), "La solución debe tener envíos asignados");
        assertFalse(resultado.getEnviosAsignados().isEmpty(), "Debe haber al menos un envío asignado");
        assertTrue(resultado.getFitness() < Double.MAX_VALUE, "Fitness debe ser finito");

        // --- Reporte ---
        System.out.println("\n╔══════════════════════════════════════════════════╗");
        System.out.println("║            RESULTADO DHGS                        ║");
        System.out.println("╠══════════════════════════════════════════════════╣");
        System.out.printf("║  Tiempo ejecución:    %-26d ms ║%n", duracion);
        System.out.printf("║  Envíos asignados:    %-26d    ║%n", resultado.getEnviosAsignados().size());
        System.out.printf("║  Envíos no asignados: %-26d    ║%n",
                resultado.getEnviosNoAsignados() != null ? resultado.getEnviosNoAsignados().size() : 0);
        System.out.printf("║  Fitness:             %-26.2f    ║%n", resultado.getFitness());
        System.out.printf("║  Costo distancia:     %-26.2f    ║%n", resultado.getCostoDistanciaTotal());
        System.out.printf("║  Viol. capacidad:     %-26.2f    ║%n", resultado.getViolacionesCapacidad());
        System.out.printf("║  Viol. tiempo:        %-26.2f    ║%n", resultado.getViolacionesTiempo());
        System.out.printf("║  Factible:            %-26s    ║%n", resultado.isEsFactible());
        System.out.println("╚══════════════════════════════════════════════════╝");

        // Detalle de rutas asignadas
        System.out.println("\n=== RUTAS ASIGNADAS ===");
        for (Map.Entry<Envio, RutaEnvio> entry : resultado.getEnviosAsignados().entrySet()) {
            Envio e = entry.getKey();
            RutaEnvio r = entry.getValue();
            String vuelos_str = r.getSecuenciaVuelos().stream()
                    .map(v -> v.getAeropuertoOrigen().getCodigoICAO() + "->"
                            + v.getAeropuertoDestino().getCodigoICAO())
                    .collect(Collectors.joining(" → "));

            System.out.printf("  [%s] %s->%s (%d maletas) via: %s | dist=%.0f km | costo=%.0f%n",
                    e.getId(),
                    e.getAeropuertoOrigen().getCodigoICAO(),
                    e.getAeropuertoDestino().getCodigoICAO(),
                    e.getCantidadMaletas(),
                    vuelos_str,
                    r.getDistanciaTotal(),
                    r.getCosto());
        }

        // Envíos no asignados
        if (resultado.getEnviosNoAsignados() != null && !resultado.getEnviosNoAsignados().isEmpty()) {
            System.out.println("\n--- ENVIOS NO ASIGNADOS ---");
            for (Envio e : resultado.getEnviosNoAsignados()) {
                System.out.printf("  [%s] %s->%s (%d maletas) mustGo=%s%n",
                        e.getId(),
                        e.getAeropuertoOrigen().getCodigoICAO(),
                        e.getAeropuertoDestino().getCodigoICAO(),
                        e.getCantidadMaletas(),
                        e.isEsMustGo());
            }
        }

        // Validación con Validador
        List<String> violaciones = validador.validarIndividuo(resultado);
        System.out.println("\n--- VALIDACION ---");
        if (violaciones.isEmpty()) {
            System.out.println("  [OK] Sin violaciones -- solucion completamente factible");
        } else {
            violaciones.forEach(v -> System.out.println("  [!] " + v));
        }
    }

    private static Path getResourcePath(String relativePath) throws Exception {
        URL url = DHGSIntegrationTest.class.getClassLoader().getResource(relativePath);
        assertNotNull(url, "Recurso no encontrado: " + relativePath);
        return Paths.get(url.toURI());
    }
}

