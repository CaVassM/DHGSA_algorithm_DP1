package com.tasfb2b.dhgs.demo.algorithm;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.algorithm.ialns.IALNSAlgorithm;
import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.InstanciaVuelo;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
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
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DisplayName("IALNS - Simulación completa end-to-end")
class IALNSIntegrationTest {

    private static Map<String, Aeropuerto> aeropuertosMap;
    private static List<Aeropuerto> aeropuertos;
    private static List<Vuelo> vuelos;
    private static List<Envio> envios;
    private static GrafoVuelos grafoVuelos;
    private static LocalDate inicioHorizonte;

    private static final AeropuertoParser aeropuertoParser = new AeropuertoParser();
    private static final VueloParser vueloParser = new VueloParser();
    private static final EnvioParser envioParser = new EnvioParser();

    @BeforeAll
    static void cargarDatos() throws Exception {
        Properties props = new Properties();
        try (InputStream is = IALNSIntegrationTest.class
                .getClassLoader()
                .getResourceAsStream("test-ingestion.properties")) {
            assertNotNull(is, "No se encontró test-ingestion.properties");
            props.load(is);
        }

        Path pathAeropuertos = getResourcePath(props.getProperty("test.data.aeropuertos"));
        aeropuertos = aeropuertoParser.parsear(pathAeropuertos);
        aeropuertosMap = aeropuertos.stream()
                .collect(Collectors.toMap(Aeropuerto::getCodigoICAO, a -> a));

        Path pathVuelos = getResourcePath(props.getProperty("test.data.vuelos"));
        vuelos = vueloParser.parsear(pathVuelos, aeropuertosMap);

        Path dirEnvios = getResourcePath(props.getProperty("test.data.envios.directorio"));
        envios = new ArrayList<>();
        try (Stream<Path> stream = Files.list(dirEnvios)) {
            stream.filter(p -> p.getFileName().toString().startsWith("envios_")
                            && p.getFileName().toString().endsWith(".txt"))
                    .sorted()
                    .forEach(archivo -> envios.addAll(envioParser.parsear(archivo, aeropuertosMap)));
        }

        inicioHorizonte = envios.stream()
                .map(Envio::getFechaHoraCreacion)
                .min(LocalDateTime::compareTo)
                .orElseThrow()
                .toLocalDate()
                .minusDays(1);

        grafoVuelos = new GrafoVuelos();
        grafoVuelos.construir(aeropuertos, vuelos, inicioHorizonte, 5);
    }

    @Test
    @DisplayName("1. Grafo de vuelos tiene conectividad válida")
    void grafoTieneConectividad() {
        long conexiones = envios.stream()
                .filter(envio -> grafoVuelos.existeConexion(
                        envio.getAeropuertoOrigen().getCodigoICAO(),
                        envio.getAeropuertoDestino().getCodigoICAO()))
                .count();

        assertTrue(conexiones > 0, "Debe haber al menos una conexión válida");
    }

    @Test
    @DisplayName("2. Ejecución completa del algoritmo IALNS")
    void ejecutarIALNSCompleto() {
        AlgoritmoSPLIT split = new AlgoritmoSPLIT(grafoVuelos);
        CalculadorFitness fitness = new CalculadorFitness();
        Validador validador = new Validador();
        ConstructorSolucionesIniciales constructor = new ConstructorSolucionesIniciales(grafoVuelos, split, fitness);
        IALNSAlgorithm ialns = new IALNSAlgorithm(constructor, split, fitness, validador);

        Individuo resultado = ialns.ejecutar(envios, 1, 1, 10, Duration.ofSeconds(10));

        assertNotNull(resultado, "IALNS debe retornar una solución");
        assertNotNull(resultado.getEnviosAsignados(), "La solución debe inicializar envíos asignados");
        assertFalse(resultado.getEnviosAsignados().isEmpty(), "IALNS debe asignar al menos un envío");
        assertTrue(resultado.getFitness() < Double.MAX_VALUE, "El fitness debe ser finito");
        assertNotNull(resultado.getRepresentacionGigante(), "Debe conservar la cobertura completa de envíos");
        assertEquals(resultado.getRepresentacionGigante().size(),
                new HashSet<>(resultado.getRepresentacionGigante()).size(),
                "El giant tour no debe contener envíos duplicados");
        assertTrue(resultado.getRepresentacionGigante().containsAll(resultado.getEnviosAsignados().keySet()),
                "Todo envío asignado debe aparecer en la representación gigante");
    }

    @Test
    @DisplayName("3. Más tiempo de ejecución no empeora la mejor solución")
    void masTiempoNoEmpeora() {
        AlgoritmoSPLIT split = new AlgoritmoSPLIT(grafoVuelos);
        CalculadorFitness fitness = new CalculadorFitness();
        Validador validador = new Validador();
        ConstructorSolucionesIniciales constructor = new ConstructorSolucionesIniciales(grafoVuelos, split, fitness);

        IALNSAlgorithm ialns5s = new IALNSAlgorithm(constructor, split, fitness, validador);
        IALNSAlgorithm ialns10s = new IALNSAlgorithm(constructor, split, fitness, validador);

        Individuo corto = ialns5s.ejecutar(envios, 1, 1, 10, Duration.ofSeconds(5));
        Individuo largo = ialns10s.ejecutar(envios, 1, 1, 10, Duration.ofSeconds(10));

        assertTrue(largo.getFitness() <= corto.getFitness() + 1.0,
                "Mayor tiempo no debería empeorar la mejor solución almacenada");
    }

    @Test
    @DisplayName("4. El grafo materializa 5 días de vuelos recurrentes")
    void grafoMaterializaCincoDiasDeInstancias() {
        int vuelosMaterializados = grafoVuelos.getAdyacencia().values().stream()
                .mapToInt(List::size)
                .sum();

        assertEquals(vuelos.size() * 5, vuelosMaterializados,
                "Cada vuelo plantilla debe materializarse una vez por día del horizonte");

        long instancias = grafoVuelos.getAdyacencia().values().stream()
                .flatMap(List::stream)
                .filter(InstanciaVuelo.class::isInstance)
                .count();

        assertEquals(vuelosMaterializados, instancias,
                "El grafo del horizonte debe componerse solo de instancias diarias");
    }

    private static Path getResourcePath(String relativePath) throws Exception {
        URL url = IALNSIntegrationTest.class.getClassLoader().getResource(relativePath);
        assertNotNull(url, "Recurso no encontrado: " + relativePath);
        return Paths.get(url.toURI());
    }
}