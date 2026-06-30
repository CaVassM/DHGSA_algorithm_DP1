package com.tasfb2b.dhgs.demo.ingestion;

import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.service.EpocaData;
import com.tasfb2b.dhgs.demo.domain.service.SimuladorEpocas;
import com.tasfb2b.dhgs.demo.infraestructure.ingestion.AeropuertoParser;
import com.tasfb2b.dhgs.demo.infraestructure.ingestion.EnvioParser;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Experimento de carga ESCALADA sobre el dataset real completo (~9.5M envíos).
 *
 * Mide el pipeline parseo + organización en épocas a escalas crecientes
 * (1% → 5% → 10%) para ubicar dónde el motor empieza a sufrir en tiempo y
 * memoria. Sirve para calibrar K y dimensionar las demos.
 *
 * Los archivos reales completos (391 MB) NO se versionan: este test los lee de
 * una ruta del sistema configurable por la propiedad {@code datos.reales.dir}
 * (por defecto la carpeta de descargas usada en desarrollo). Si la carpeta no
 * existe, el test se SALTA (Assumptions) en vez de fallar — así no rompe en CI
 * ni en otra máquina.
 *
 * Marcado {@code @Tag("slow-experiment")}: excluido de la suite rápida; correr con
 *   ./mvnw -pl modules/backend test -Pwith-experiments -Dtest=CargaEscaladaExperimentoTest
 * y opcionalmente -Ddatos.reales.dir=RUTA y más heap: -DargLine="-Xmx4g".
 */
@Tag("slow-experiment")
@DisplayName("Experimento de carga escalada (dataset real completo)")
class CargaEscaladaExperimentoTest {

    private static final AeropuertoParser aeropuertoParser = new AeropuertoParser();
    private static final EnvioParser envioParser = new EnvioParser();

    /** Carpeta de los archivos reales completos. Ajustable por -Ddatos.reales.dir=... */
    private static final String DIR_REALES = System.getProperty(
            "datos.reales.dir",
            "C:/Users/HP/Downloads/DATOS");

    /** Archivo de aeropuertos real (en el classpath de test, sí versionado). */
    private static final String AEROPUERTOS_RES = "datos/estudiantes_real.txt";

    @Test
    @DisplayName("Carga escalada 1% → 5% → 10% del dataset real")
    void cargaEscalada() throws Exception {
        Path dirEnvios = Paths.get(DIR_REALES, "_envios_preliminar_ (2)");
        Assumptions.assumeTrue(Files.isDirectory(dirEnvios),
                "Carpeta de datos reales no encontrada: " + dirEnvios
                        + " (define -Ddatos.reales.dir). Test omitido.");

        // Aeropuertos reales (mapa ICAO → Aeropuerto) desde el classpath de test.
        Path aeroPath = Paths.get(
                CargaEscaladaExperimentoTest.class.getClassLoader()
                        .getResource(AEROPUERTOS_RES).toURI());
        List<Aeropuerto> aeropuertos = aeropuertoParser.parsear(aeroPath);
        Map<String, Aeropuerto> mapaAeropuertos = aeropuertos.stream()
                .collect(Collectors.toMap(Aeropuerto::getCodigoICAO, a -> a));

        List<Path> archivos;
        try (Stream<Path> s = Files.list(dirEnvios)) {
            archivos = s.filter(p -> p.getFileName().toString().endsWith(".txt"))
                    .sorted().collect(Collectors.toList());
        }

        // Total de envíos para calcular el N por archivo de cada escala.
        // Repartimos la escala de forma uniforme: N por archivo = totalArchivo * pct.
        System.out.println("\n========== EXPERIMENTO DE CARGA ESCALADA ==========");
        System.out.printf("Archivos: %d | aeropuertos: %d%n", archivos.size(), aeropuertos.size());
        System.out.println("Escala | envíos | parseo(s) | épocas | organizar(s) | heap usado(MB)");
        System.out.println("-------|--------|-----------|--------|--------------|---------------");

        double[] escalas = {0.01, 0.05, 0.10};
        for (double pct : escalas) {
            medirEscala(pct, archivos, mapaAeropuertos, aeropuertos);
        }
        System.out.println("===================================================\n");
    }

    private void medirEscala(double pct, List<Path> archivos,
                             Map<String, Aeropuerto> mapaAeropuertos,
                             List<Aeropuerto> aeropuertos) throws Exception {
        // --- Parseo: tomar primeros (pct * lineasArchivo) de cada archivo ---
        long t0 = System.nanoTime();
        List<Envio> envios = new ArrayList<>();
        for (Path archivo : archivos) {
            long totalLineas = contarLineas(archivo);
            long n = Math.max(1, Math.round(totalLineas * pct));
            Path muestra = muestraTemporal(archivo, n);
            try {
                envios.addAll(envioParser.parsear(muestra, mapaAeropuertos));
            } finally {
                Files.deleteIfExists(muestra);
            }
        }
        double parseoSeg = (System.nanoTime() - t0) / 1_000_000_000.0;

        // --- Organización en épocas (lo que el motor hace antes de optimizar) ---
        SimuladorEpocas simulador = new SimuladorEpocas();
        LocalDateTime inicio = envios.stream()
                .map(Envio::getFechaHoraCreacion)
                .min(LocalDateTime::compareTo).orElse(LocalDateTime.now());
        long t1 = System.nanoTime();
        List<EpocaData> epocas = simulador.organizarEnEpocas(
                envios, aeropuertos, inicio, 4, 7);
        double organizarSeg = (System.nanoTime() - t1) / 1_000_000_000.0;

        // --- Memoria aproximada tras la carga ---
        System.gc();
        Runtime rt = Runtime.getRuntime();
        long heapMb = (rt.totalMemory() - rt.freeMemory()) / (1024 * 1024);

        System.out.printf("%5.0f%% | %6d | %9.2f | %6d | %12.2f | %14d%n",
                pct * 100, envios.size(), parseoSeg, epocas.size(), organizarSeg, heapMb);
    }

    private long contarLineas(Path archivo) throws Exception {
        try (Stream<String> s = Files.lines(archivo)) {
            return s.filter(l -> !l.isBlank() && !l.startsWith("#")).count();
        }
    }

    /** Escribe los primeros n registros de datos del archivo en un temporal. */
    private Path muestraTemporal(Path origen, long n) throws Exception {
        Path tmp = Files.createTempFile("muestra_", "_" + origen.getFileName());
        try (Stream<String> s = Files.lines(origen)) {
            List<String> lineas = s.filter(l -> !l.isBlank() && !l.startsWith("#"))
                    .limit(n).collect(Collectors.toList());
            Files.write(tmp, lineas);
        }
        return tmp;
    }
}
