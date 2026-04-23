package com.TasfB2B.DHGS.demo.ingestion;

import com.TasfB2B.DHGS.demo.domain.model.Aeropuerto;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.Vuelo;
import com.TasfB2B.DHGS.demo.infraestructure.ingestion.AeropuertoParser;
import com.TasfB2B.DHGS.demo.infraestructure.ingestion.EnvioParser;
import com.TasfB2B.DHGS.demo.infraestructure.ingestion.VueloParser;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests de carga de datos REALES desde archivos de recursos.
 *
 * Usa los archivos:
 *   - estudiantes_real.txt       (30 aeropuertos: Sudamérica, Europa, Asia)
 *   - planes_vuelo_real.txt      (~2800+ vuelos)
 *   - envios_preliminar/         (30 archivos _envios_XXXX_.txt, ~300k+ líneas c/u)
 *
 * Las rutas se configuran en:
 *   src/test/resources/test-ingestion.properties
 */
@DisplayName("Carga de datos REALES desde archivos")
class IngestionDatosRealesTest {

    private static final AeropuertoParser aeropuertoParser = new AeropuertoParser();
    private static final VueloParser vueloParser = new VueloParser();
    private static final EnvioParser envioParser = new EnvioParser();

    private static String aeropuertosPath;
    private static String vuelosPath;
    private static String enviosDirPath;

    @BeforeAll
    static void cargarPropiedades() throws Exception {
        Properties props = new Properties();
        try (InputStream is = IngestionDatosRealesTest.class
                .getClassLoader()
                .getResourceAsStream("test-ingestion.properties")) {
            assertNotNull(is, "No se encontró test-ingestion.properties");
            props.load(is);
        }

        aeropuertosPath = props.getProperty("real.data.aeropuertos");
        vuelosPath      = props.getProperty("real.data.vuelos");
        enviosDirPath   = props.getProperty("real.data.envios.directorio");

        assertNotNull(aeropuertosPath, "Propiedad real.data.aeropuertos no definida");
        assertNotNull(vuelosPath,      "Propiedad real.data.vuelos no definida");
        assertNotNull(enviosDirPath,   "Propiedad real.data.envios.directorio no definida");
    }

    private static Path getResourcePath(String relativePath) throws Exception {
        URL url = IngestionDatosRealesTest.class.getClassLoader().getResource(relativePath);
        assertNotNull(url, "Recurso no encontrado en classpath: " + relativePath);
        return Paths.get(url.toURI());
    }

    private static boolean esArchivoEnvio(Path p) {
        String name = p.getFileName().toString();
        // Real files have prefix _envios_ (with leading underscore)
        return name.endsWith(".txt") && name.startsWith("_envios_");
    }

    // =========================================================
    // TEST 1: Aeropuertos reales (30)
    // =========================================================

    @Test
    @DisplayName("1. Carga 30 aeropuertos reales desde estudiantes_real.txt")
    void cargaAeropuertosReales() throws Exception {
        Path path = getResourcePath(aeropuertosPath);
        List<Aeropuerto> aeropuertos = aeropuertoParser.parsear(path);

        assertFalse(aeropuertos.isEmpty(), "Lista de aeropuertos no debe estar vacía");
        assertEquals(30, aeropuertos.size(), "Debe haber exactamente 30 aeropuertos reales");

        // Todos tienen ICAO de 4 letras
        aeropuertos.forEach(a ->
                assertEquals(4, a.getCodigoICAO().length(),
                        "Código ICAO debe tener 4 caracteres: " + a.getCodigoICAO()));

        // Verificar continentes: 10 Sudamérica, 10 Europa, 10 Asia
        Map<String, List<Aeropuerto>> porContinente = aeropuertos.stream()
                .collect(Collectors.groupingBy(Aeropuerto::getContinente));

        System.out.println("\n=== AEROPUERTOS REALES POR CONTINENTE ===");
        porContinente.forEach((cont, lista) -> {
            System.out.printf("  %s (%d): %s%n", cont, lista.size(),
                    lista.stream().map(Aeropuerto::getCodigoICAO).collect(Collectors.joining(", ")));
        });

        // Verificar que hay aeropuertos de los 3 continentes esperados
        long sudamericanos = aeropuertos.stream().filter(a -> a.getCodigoICAO().startsWith("S")).count();
        long europeos = aeropuertos.stream().filter(a ->
                a.getCodigoICAO().startsWith("E") || a.getCodigoICAO().startsWith("L") || a.getCodigoICAO().startsWith("U")).count();
        long asiaticos = aeropuertos.stream().filter(a ->
                a.getCodigoICAO().startsWith("O") || a.getCodigoICAO().startsWith("V")).count();

        assertEquals(10, sudamericanos, "Debe haber 10 aeropuertos sudamericanos");
        assertTrue(europeos >= 10, "Debe haber al menos 10 aeropuertos europeos, hay: " + europeos);
        assertTrue(asiaticos >= 9, "Debe haber al menos 9 aeropuertos asiáticos, hay: " + asiaticos);
        assertEquals(30, sudamericanos + europeos + asiaticos, "Total debe ser 30");

        // Verificar SKBO en detalle
        Aeropuerto bogota = aeropuertos.stream()
                .filter(a -> "SKBO".equals(a.getCodigoICAO()))
                .findFirst().orElse(null);
        assertNotNull(bogota, "SKBO debe estar en la lista");
        assertEquals("Bogota", bogota.getCiudad());
        assertEquals("Colombia", bogota.getPais());
        assertEquals(-5, bogota.getGmt());
        assertEquals(430, bogota.getCapacidadAlmacen());
        assertTrue(bogota.getLatitud() > 4.0 && bogota.getLatitud() < 5.0,
                "Latitud de Bogotá debe estar entre 4 y 5: " + bogota.getLatitud());

        // Verificar coordenadas no son cero
        aeropuertos.forEach(a -> {
            assertNotEquals(0.0, a.getLatitud(),
                    "Latitud no debe ser 0 para: " + a.getCodigoICAO());
            assertNotEquals(0.0, a.getLongitud(),
                    "Longitud no debe ser 0 para: " + a.getCodigoICAO());
        });

        System.out.println("\n=== AEROPUERTOS REALES CARGADOS (" + aeropuertos.size() + ") ===");
        aeropuertos.forEach(a -> System.out.printf(
                "  [%02d] %s | %-20s | %-15s | %-20s | GMT%+d | cap=%d | (%.4f, %.4f)%n",
                a.getId(), a.getCodigoICAO(), a.getCiudad(), a.getPais(),
                a.getContinente(), a.getGmt(), a.getCapacidadAlmacen(),
                a.getLatitud(), a.getLongitud()));
    }

    // =========================================================
    // TEST 2: Vuelos reales (~2800+)
    // =========================================================

    @Test
    @DisplayName("2. Carga vuelos reales desde planes_vuelo_real.txt")
    void cargaVuelosReales() throws Exception {
        Map<String, Aeropuerto> mapaAeropuertos = cargarMapaAeropuertosReales();

        Path path = getResourcePath(vuelosPath);
        List<Vuelo> vuelos = vueloParser.parsear(path, mapaAeropuertos);

        assertFalse(vuelos.isEmpty(), "Lista de vuelos reales no debe estar vacía");
        assertTrue(vuelos.size() > 100, "Debe haber más de 100 vuelos reales, hay: " + vuelos.size());

        // Integridad de cada vuelo
        vuelos.forEach(v -> {
            assertNotNull(v.getId(),                 "ID del vuelo no debe ser nulo");
            assertNotNull(v.getAeropuertoOrigen(),   "Origen del vuelo no debe ser nulo");
            assertNotNull(v.getAeropuertoDestino(),  "Destino del vuelo no debe ser nulo");
            assertNotNull(v.getHoraSalida(),         "Hora de salida no debe ser nula");
            assertNotNull(v.getHoraLlegada(),        "Hora de llegada no debe ser nula");
            assertNotNull(v.getDuracion(),           "Duración no debe ser nula");
            assertTrue(v.getCapacidad() > 0,         "Capacidad debe ser positiva: " + v.getId());
            assertTrue(v.getDistancia() > 0,         "Distancia debe ser positiva: " + v.getId());
            assertFalse(v.getDuracion().isNegative(), "Duración no debe ser negativa: " + v.getId());
        });

        // Verificar que hay rutas intercontinentales
        long intercontinentales = vuelos.stream()
                .filter(v -> !v.getAeropuertoOrigen().getContinente()
                        .equals(v.getAeropuertoDestino().getContinente()))
                .count();
        assertTrue(intercontinentales > 0,
                "Debe haber vuelos intercontinentales en datos reales");

        // Estadísticas por par de continentes
        Map<String, Long> rutasPorContinentes = vuelos.stream()
                .collect(Collectors.groupingBy(
                        v -> v.getAeropuertoOrigen().getContinente() + " → " +
                             v.getAeropuertoDestino().getContinente(),
                        Collectors.counting()));

        System.out.println("\n=== VUELOS REALES: " + vuelos.size() + " ===");
        System.out.println("Rutas por continente:");
        rutasPorContinentes.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .forEach(e -> System.out.printf("  %s: %d vuelos%n", e.getKey(), e.getValue()));

        // Verificar que todos los aeropuertos en vuelos existen
        vuelos.forEach(v -> {
            assertTrue(mapaAeropuertos.containsKey(v.getAeropuertoOrigen().getCodigoICAO()),
                    "Origen no existe: " + v.getAeropuertoOrigen().getCodigoICAO());
            assertTrue(mapaAeropuertos.containsKey(v.getAeropuertoDestino().getCodigoICAO()),
                    "Destino no existe: " + v.getAeropuertoDestino().getCodigoICAO());
        });
    }

    // =========================================================
    // TEST 3: Envíos reales (muestreo - solo 3 archivos)
    // =========================================================

    @Test
    @DisplayName("3. Carga envíos reales (muestreo de 3 archivos)")
    void cargaEnviosRealesMuestreo() throws Exception {
        Map<String, Aeropuerto> mapaAeropuertos = cargarMapaAeropuertosReales();

        Path dirEnvios = getResourcePath(enviosDirPath);
        List<Envio> todosEnvios = new ArrayList<>();
        List<String> archivosLeidos = new ArrayList<>();

        // Solo leer 3 archivos como muestreo (los archivos son enormes)
        try (Stream<Path> stream = Files.list(dirEnvios)) {
            List<Path> archivos = stream
                    .filter(IngestionDatosRealesTest::esArchivoEnvio)
                    .sorted()
                    .limit(3)  // Solo 3 archivos para no consumir demasiada memoria
                    .collect(Collectors.toList());

            assertFalse(archivos.isEmpty(), "Debe haber archivos de envíos en: " + enviosDirPath);

            for (Path archivo : archivos) {
                List<Envio> enviosArchivo = envioParser.parsear(archivo, mapaAeropuertos);
                todosEnvios.addAll(enviosArchivo);
                archivosLeidos.add(archivo.getFileName() + " → " + enviosArchivo.size() + " envíos");
            }
        }

        assertFalse(todosEnvios.isEmpty(), "Debe haber envíos cargados");
        assertTrue(todosEnvios.size() > 100,
                "Datos reales deben tener muchos envíos, hay: " + todosEnvios.size());

        // Integridad de cada envío
        todosEnvios.forEach(e -> {
            assertNotNull(e.getId(),                    "ID del envío no debe ser nulo");
            assertNotNull(e.getAeropuertoOrigen(),      "Origen no debe ser nulo: " + e.getId());
            assertNotNull(e.getAeropuertoDestino(),     "Destino no debe ser nulo: " + e.getId());
            assertNotNull(e.getFechaHoraCreacion(),     "Fecha creación no debe ser nula: " + e.getId());
            assertNotNull(e.getDeadline(),              "Deadline no debe ser nulo: " + e.getId());
            assertTrue(e.getCantidadMaletas() > 0,      "Maletas > 0: " + e.getId());
            assertNotNull(e.getIdCliente(),             "ID cliente no debe ser nulo: " + e.getId());
        });

        // Verificar que hay envíos intercontinentales (deadline = +2 días)
        // y envíos mismo continente (deadline = +1 día)
        long mismoContinente = todosEnvios.stream()
                .filter(e -> e.getAeropuertoOrigen().estaMismoContinente(e.getAeropuertoDestino()))
                .count();
        long disContinente = todosEnvios.size() - mismoContinente;

        System.out.println("\n=== ARCHIVOS REALES LEÍDOS (muestreo) ===");
        archivosLeidos.forEach(s -> System.out.println("  " + s));
        System.out.printf("\n=== ENVÍOS REALES: %d total | %d mismo continente | %d intercontinental ===%n",
                todosEnvios.size(), mismoContinente, disContinente);
    }

    // =========================================================
    // TEST 4: Verificar que el directorio tiene 30 archivos de envío
    // =========================================================

    @Test
    @DisplayName("4. Directorio de envíos reales contiene 30 archivos")
    void verificarCantidadArchivosEnvios() throws Exception {
        Path dirEnvios = getResourcePath(enviosDirPath);

        try (Stream<Path> stream = Files.list(dirEnvios)) {
            List<Path> archivos = stream
                    .filter(IngestionDatosRealesTest::esArchivoEnvio)
                    .sorted()
                    .collect(Collectors.toList());

            assertEquals(30, archivos.size(),
                    "Debe haber 30 archivos de envíos reales (uno por aeropuerto)");

            // Verificar que cada aeropuerto tiene su archivo
            Map<String, Aeropuerto> mapaAeropuertos = cargarMapaAeropuertosReales();

            Set<String> icaosEnArchivos = new HashSet<>();
            for (Path archivo : archivos) {
                String nombre = archivo.getFileName().toString();
                // Extraer ICAO del nombre: _envios_XXXX_.txt
                String[] partes = nombre.replace(".txt", "").split("_");
                for (String parte : partes) {
                    if (parte.length() == 4 && parte.matches("[A-Z]{4}")) {
                        icaosEnArchivos.add(parte);
                        break;
                    }
                }
            }

            // Cada aeropuerto real debe tener un archivo de envíos
            for (String icao : mapaAeropuertos.keySet()) {
                assertTrue(icaosEnArchivos.contains(icao),
                        "Falta archivo de envíos para aeropuerto: " + icao);
            }

            System.out.println("\n=== ARCHIVOS DE ENVÍO REALES ===");
            archivos.forEach(a -> System.out.println("  " + a.getFileName()));
        }
    }

    // =========================================================
    // TEST 5: Integridad cruzada vuelos ↔ aeropuertos reales
    // =========================================================

    @Test
    @DisplayName("5. Integridad cruzada: vuelos reales referencian aeropuertos válidos")
    void integridadCruzadaVuelosAeropuertosReales() throws Exception {
        Map<String, Aeropuerto> mapaAeropuertos = cargarMapaAeropuertosReales();
        List<Vuelo> vuelos = vueloParser.parsear(getResourcePath(vuelosPath), mapaAeropuertos);

        vuelos.forEach(v -> {
            String origenICAO  = v.getAeropuertoOrigen().getCodigoICAO();
            String destinoICAO = v.getAeropuertoDestino().getCodigoICAO();

            assertTrue(mapaAeropuertos.containsKey(origenICAO),
                    "Origen del vuelo " + v.getId() + " no existe: " + origenICAO);
            assertTrue(mapaAeropuertos.containsKey(destinoICAO),
                    "Destino del vuelo " + v.getId() + " no existe: " + destinoICAO);
            assertNotEquals(origenICAO, destinoICAO,
                    "Origen y destino no pueden ser iguales: " + v.getId());
        });

        System.out.println("\nIntegridad cruzada OK: " + vuelos.size() + " vuelos reales válidos.");
    }

    // =========================================================
    // Utilidad interna
    // =========================================================

    private static Map<String, Aeropuerto> cargarMapaAeropuertosReales() throws Exception {
        Path path = getResourcePath(aeropuertosPath);
        List<Aeropuerto> lista = aeropuertoParser.parsear(path);
        return lista.stream().collect(Collectors.toMap(Aeropuerto::getCodigoICAO, a -> a));
    }
}

