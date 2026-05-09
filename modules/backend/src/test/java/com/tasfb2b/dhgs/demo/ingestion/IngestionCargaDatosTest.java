package com.tasfb2b.dhgs.demo.ingestion;

import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import com.tasfb2b.dhgs.demo.infraestructure.ingestion.AeropuertoParser;
import com.tasfb2b.dhgs.demo.infraestructure.ingestion.EnvioParser;
import com.tasfb2b.dhgs.demo.infraestructure.ingestion.VueloParser;
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
 * Tests de carga de datos reales desde archivos de recursos.
 *
 * Verifica que los tres parsers (AeropuertoParser, VueloParser, EnvioParser)
 * leen correctamente los archivos ubicados en:
 *   src/test/resources/datos/
 *
 * Las rutas se configuran en:
 *   src/test/resources/test-ingestion.properties
 */
@DisplayName("Carga de datos desde archivos")
class IngestionCargaDatosTest {

    // --- Parsers (sin Spring, instanciados directamente) ---
    private static final AeropuertoParser aeropuertoParser = new AeropuertoParser();
    private static final VueloParser vueloParser = new VueloParser();
    private static final EnvioParser envioParser = new EnvioParser();

    // --- Rutas leídas del properties ---
    private static String aeropuertosPath;
    private static String vuelosPath;
    private static String enviosDirPath;

    @BeforeAll
    static void cargarPropiedades() throws Exception {
        Properties props = new Properties();
        try (InputStream is = IngestionCargaDatosTest.class
                .getClassLoader()
                .getResourceAsStream("test-ingestion.properties")) {

            assertNotNull(is,
                    "No se encontró test-ingestion.properties en src/test/resources/");
            props.load(is);
        }

        aeropuertosPath = props.getProperty("test.data.aeropuertos");
        vuelosPath      = props.getProperty("test.data.vuelos");
        enviosDirPath   = props.getProperty("test.data.envios.directorio");

        assertNotNull(aeropuertosPath, "Propiedad test.data.aeropuertos no definida");
        assertNotNull(vuelosPath,      "Propiedad test.data.vuelos no definida");
        assertNotNull(enviosDirPath,   "Propiedad test.data.envios.directorio no definida");
    }

    // Utilidad: convierte ruta relativa al classpath en Path absoluto
    private static Path getResourcePath(String relativePath) throws Exception {
        URL url = IngestionCargaDatosTest.class.getClassLoader().getResource(relativePath);
        assertNotNull(url, "Recurso no encontrado en classpath: " + relativePath);
        return Paths.get(url.toURI());
    }

    // Utilidad: filtra archivos de envío (con o sin prefijo _)
    private static boolean esArchivoEnvio(Path p) {
        String name = p.getFileName().toString();
        return name.endsWith(".txt") && (name.startsWith("envios_") || name.startsWith("_envios_"));
    }

    // =========================================================
    // TEST 1: Aeropuertos
    // =========================================================

    @Test
    @DisplayName("1. Carga aeropuertos desde estudiantes.txt")
    void cargaAeropuertosDesdeArchivo() throws Exception {
        Path path = getResourcePath(aeropuertosPath);
        List<Aeropuerto> aeropuertos = aeropuertoParser.parsear(path);

        // --- Cantidad ---
        assertFalse(aeropuertos.isEmpty(), "Lista de aeropuertos no debe estar vacía");
        assertEquals(7, aeropuertos.size(), "Debe haber exactamente 7 aeropuertos");

        // --- Verificar SKBO (Bogotá) en detalle ---
        Aeropuerto bogota = aeropuertos.stream()
                .filter(a -> "SKBO".equals(a.getCodigoICAO()))
                .findFirst()
                .orElse(null);

        assertNotNull(bogota, "SKBO (Bogotá) debe estar en la lista");
        assertEquals("Bogota",       bogota.getCiudad());
        assertEquals("Colombia",     bogota.getPais());
        assertEquals(-5,             bogota.getGmt());
        assertEquals(430,            bogota.getCapacidadAlmacen());
        assertEquals("America del Sur", bogota.getContinente());
        assertEquals(4.7014, bogota.getLatitud(),  0.01);
        assertEquals(-74.1469, bogota.getLongitud(), 0.01);

        // --- Todos tienen ICAO de 4 letras ---
        aeropuertos.forEach(a ->
                assertEquals(4, a.getCodigoICAO().length(),
                        "Código ICAO debe tener 4 caracteres: " + a.getCodigoICAO()));

        // --- Todos son de América del Sur (prefijo S*) ---
        aeropuertos.forEach(a ->
                assertEquals("America del Sur", a.getContinente(),
                        "Todos los aeropuertos deben ser de América del Sur: " + a.getCodigoICAO()));

        System.out.println("\n=== AEROPUERTOS CARGADOS (" + aeropuertos.size() + ") ===");
        aeropuertos.forEach(a -> System.out.printf(
                "  [%02d] %s | %-12s | %-10s | GMT%+d | cap=%d | (%.4f, %.4f)%n",
                a.getId(), a.getCodigoICAO(), a.getCiudad(), a.getPais(),
                a.getGmt(), a.getCapacidadAlmacen(), a.getLatitud(), a.getLongitud()));
    }

    // =========================================================
    // TEST 2: Vuelos
    // =========================================================

    @Test
    @DisplayName("2. Carga vuelos desde planes_vuelo.txt")
    void cargaVuelosDesdeArchivo() throws Exception {
        Map<String, Aeropuerto> mapaAeropuertos = cargarMapaAeropuertos();

        Path path = getResourcePath(vuelosPath);
        List<Vuelo> vuelos = vueloParser.parsear(path, mapaAeropuertos);

        // --- Cantidad ---
        assertFalse(vuelos.isEmpty(), "Lista de vuelos no debe estar vacía");
        assertEquals(15, vuelos.size(), "Debe haber exactamente 15 vuelos");

        // --- Integridad de cada vuelo ---
        vuelos.forEach(v -> {
            assertNotNull(v.getId(),                 "ID del vuelo no debe ser nulo");
            assertNotNull(v.getAeropuertoOrigen(),   "Origen del vuelo no debe ser nulo");
            assertNotNull(v.getAeropuertoDestino(),  "Destino del vuelo no debe ser nulo");
            assertNotNull(v.getHoraSalida(),         "Hora de salida no debe ser nula");
            assertNotNull(v.getHoraLlegada(),        "Hora de llegada no debe ser nula");
            assertNotNull(v.getDuracion(),           "Duración no debe ser nula");
            assertTrue(v.getCapacidad() > 0,         "Capacidad debe ser positiva: " + v.getId());
            assertTrue(v.getDistancia() > 0,         "Distancia (Haversine) debe ser positiva: " + v.getId());
            assertFalse(v.getDuracion().isNegative(),"Duración no debe ser negativa: " + v.getId());
        });

        System.out.println("\n=== VUELOS CARGADOS (" + vuelos.size() + ") ===");
        vuelos.forEach(v -> System.out.printf(
                "  %s | %s→%s | %s→%s | cap=%d | dist=%.0f km%n",
                v.getId(),
                v.getAeropuertoOrigen().getCodigoICAO(),
                v.getAeropuertoDestino().getCodigoICAO(),
                v.getHoraSalida(), v.getHoraLlegada(),
                v.getCapacidad(), v.getDistancia()));
    }

    // =========================================================
    // TEST 3: Envíos
    // =========================================================

    @Test
    @DisplayName("3. Carga envíos desde carpeta envios_preliminar/")
    void cargaEnviosDesdeCarpeta() throws Exception {
        Map<String, Aeropuerto> mapaAeropuertos = cargarMapaAeropuertos();

        Path dirEnvios = getResourcePath(enviosDirPath);
        List<Envio> todosEnvios = new ArrayList<>();
        List<String> archivosLeidos = new ArrayList<>();

        try (Stream<Path> stream = Files.list(dirEnvios)) {
            List<Path> archivos = stream
                    .filter(IngestionCargaDatosTest::esArchivoEnvio)
                    .sorted()
                    .collect(Collectors.toList());

            assertFalse(archivos.isEmpty(), "Debe haber al menos un archivo de envíos en: " + enviosDirPath);

            for (Path archivo : archivos) {
                List<Envio> enviosArchivo = envioParser.parsear(archivo, mapaAeropuertos);
                todosEnvios.addAll(enviosArchivo);
                archivosLeidos.add(archivo.getFileName() + " → " + enviosArchivo.size() + " envíos");
            }
        }

        // --- Cantidad esperada: 6 (SKBO) + 4 (SEQM) + 4 (SPIM) = 14 ---
        assertFalse(todosEnvios.isEmpty(), "Debe haber envíos cargados");
        assertEquals(14, todosEnvios.size(), "Debe haber exactamente 14 envíos en total");

        // --- Integridad de cada envío ---
        todosEnvios.forEach(e -> {
            assertNotNull(e.getId(),                    "ID del envío no debe ser nulo");
            assertNotNull(e.getAeropuertoOrigen(),      "Origen no debe ser nulo: " + e.getId());
            assertNotNull(e.getAeropuertoDestino(),     "Destino no debe ser nulo: " + e.getId());
            assertNotNull(e.getFechaHoraCreacion(),     "Fecha de creación no debe ser nula: " + e.getId());
            assertNotNull(e.getDeadline(),              "Deadline no debe ser nulo: " + e.getId());
            assertTrue(e.getCantidadMaletas() > 0,     "Maletas deben ser > 0: " + e.getId());
            assertNotNull(e.getIdCliente(),             "ID cliente no debe ser nulo: " + e.getId());
            // Todos en mismo continente → deadline = creación + 1 día
            assertEquals(
                    e.getFechaHoraCreacion().plusDays(1),
                    e.getDeadline(),
                    "Deadline debe ser +1 día (mismo continente): " + e.getId());
        });

        // --- IDs únicos ---
        long idsUnicos = todosEnvios.stream().map(Envio::getId).distinct().count();
        assertEquals(todosEnvios.size(), idsUnicos, "Todos los IDs de envíos deben ser únicos");

        System.out.println("\n=== ARCHIVOS LEÍDOS ===");
        archivosLeidos.forEach(s -> System.out.println("  " + s));
        System.out.println("\n=== ENVÍOS CARGADOS (" + todosEnvios.size() + ") ===");
        todosEnvios.forEach(e -> System.out.printf(
                "  %s | %s→%s | %d maletas | mustGo=%-5s | deadline=%s%n",
                e.getId(),
                e.getAeropuertoOrigen().getCodigoICAO(),
                e.getAeropuertoDestino().getCodigoICAO(),
                e.getCantidadMaletas(),
                e.isEsMustGo(),
                e.getDeadline()));
    }

    // =========================================================
    // TEST 4: Integridad cruzada vuelos ↔ aeropuertos
    // =========================================================

    @Test
    @DisplayName("4. Integridad cruzada: todos los vuelos referencian aeropuertos válidos")
    void integridadCruzadaVuelosAeropuertos() throws Exception {
        Map<String, Aeropuerto> mapaAeropuertos = cargarMapaAeropuertos();
        List<Vuelo> vuelos = vueloParser.parsear(getResourcePath(vuelosPath), mapaAeropuertos);

        vuelos.forEach(v -> {
            String origenICAO  = v.getAeropuertoOrigen().getCodigoICAO();
            String destinoICAO = v.getAeropuertoDestino().getCodigoICAO();

            assertTrue(mapaAeropuertos.containsKey(origenICAO),
                    "Origen del vuelo " + v.getId() + " no existe en aeropuertos: " + origenICAO);
            assertTrue(mapaAeropuertos.containsKey(destinoICAO),
                    "Destino del vuelo " + v.getId() + " no existe en aeropuertos: " + destinoICAO);
            assertNotEquals(origenICAO, destinoICAO,
                    "Origen y destino no pueden ser el mismo: " + v.getId());
        });

        System.out.println("\nIntegridad cruzada OK: " + vuelos.size() + " vuelos con aeropuertos válidos.");
    }

    // =========================================================
    // TEST 5: Integridad cruzada envíos ↔ aeropuertos
    // =========================================================

    @Test
    @DisplayName("5. Integridad cruzada: todos los envíos referencian aeropuertos válidos")
    void integridadCruzadaEnviosAeropuertos() throws Exception {
        Map<String, Aeropuerto> mapaAeropuertos = cargarMapaAeropuertos();
        Path dirEnvios = getResourcePath(enviosDirPath);
        List<Envio> todosEnvios = new ArrayList<>();

        try (Stream<Path> stream = Files.list(dirEnvios)) {
            stream.filter(IngestionCargaDatosTest::esArchivoEnvio)
                  .sorted()
                  .forEach(archivo -> todosEnvios.addAll(envioParser.parsear(archivo, mapaAeropuertos)));
        }

        todosEnvios.forEach(e -> {
            assertTrue(mapaAeropuertos.containsKey(e.getAeropuertoOrigen().getCodigoICAO()),
                    "Origen del envío " + e.getId() + " no existe en aeropuertos");
            assertTrue(mapaAeropuertos.containsKey(e.getAeropuertoDestino().getCodigoICAO()),
                    "Destino del envío " + e.getId() + " no existe en aeropuertos");
        });

        System.out.println("\nIntegridad cruzada OK: " + todosEnvios.size() + " envíos con aeropuertos válidos.");
    }

    // =========================================================
    // Utilidad interna
    // =========================================================

    /** Carga aeropuertos y los devuelve como mapa ICAO → Aeropuerto. */
    private static Map<String, Aeropuerto> cargarMapaAeropuertos() throws Exception {
        Path path = getResourcePath(aeropuertosPath);
        List<Aeropuerto> lista = aeropuertoParser.parsear(path);
        return lista.stream().collect(Collectors.toMap(Aeropuerto::getCodigoICAO, a -> a));
    }
}

