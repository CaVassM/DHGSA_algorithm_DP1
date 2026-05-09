package com.tasfb2b.dhgs.demo.infraestructure.ingestion;

import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Parser para el archivo planes_vuelo.txt que contiene los vuelos programados.
 *
 * Formato esperado por línea:
 * SKBO-SEQM-03:34-04:21-0300
 *
 * Campos (separados por '-'):
 * [0] = Código ICAO origen
 * [1] = Código ICAO destino
 * [2] = Hora salida (HH:mm)
 * [3] = Hora llegada (HH:mm)
 * [4] = Capacidad (número de maletas)
 */
@Component
public class VueloParser {

    private static final Logger log = LoggerFactory.getLogger(VueloParser.class);
    private static final DateTimeFormatter HORA_FORMAT = DateTimeFormatter.ofPattern("HH:mm");

    /**
     * Parsea el archivo de vuelos.
     *
     * @param archivo     ruta al archivo planes_vuelo.txt
     * @param aeropuertos mapa de código ICAO → Aeropuerto (para vincular referencias)
     * @return lista de vuelos parseados
     */
    public List<Vuelo> parsear(Path archivo, Map<String, Aeropuerto> aeropuertos) {
        List<Vuelo> vuelos = new ArrayList<>();

        try {
            List<String> lineas = Files.readAllLines(archivo);
            int contador = 0;

            for (String linea : lineas) {
                linea = linea.trim();
                if (linea.isEmpty() || linea.startsWith("#")) continue;

                try {
                    Vuelo vuelo = parsearLinea(linea, aeropuertos, ++contador);
                    if (vuelo != null) {
                        vuelos.add(vuelo);
                    }
                } catch (Exception e) {
                    log.warn("Error parseando línea de vuelo: '{}' - {}", linea, e.getMessage());
                }
            }

            log.info("Parseados {} vuelos desde {}", vuelos.size(), archivo.getFileName());

        } catch (IOException e) {
            log.error("Error leyendo archivo de vuelos: {}", archivo, e);
        }

        return vuelos;
    }

    /**
     * Parsea una línea individual de vuelo.
     * Formato: SKBO-SEQM-03:34-04:21-0300
     */
    private Vuelo parsearLinea(String linea, Map<String, Aeropuerto> aeropuertos, int numero) {
        String[] partes = linea.split("-");

        // El formato tiene 5 campos separados por '-'
        // Pero la hora puede contener ':', así que hay que manejar los campos con cuidado
        // SKBO-SEQM-03:34-04:21-0300 → split por '-' da:
        // [SKBO, SEQM, 03:34, 04:21, 0300]
        if (partes.length < 5) {
            log.warn("Línea con formato inválido (se esperan 5 campos): '{}'", linea);
            return null;
        }

        String origenICAO = partes[0].trim();
        String destinoICAO = partes[1].trim();
        String horaSalidaStr = partes[2].trim();
        String horaLlegadaStr = partes[3].trim();
        String capacidadStr = partes[4].trim();

        // Buscar aeropuertos
        Aeropuerto origen = aeropuertos.get(origenICAO);
        Aeropuerto destino = aeropuertos.get(destinoICAO);

        if (origen == null) {
            log.warn("Aeropuerto origen no encontrado: {} en línea '{}'", origenICAO, linea);
            return null;
        }
        if (destino == null) {
            log.warn("Aeropuerto destino no encontrado: {} en línea '{}'", destinoICAO, linea);
            return null;
        }

        // Parsear horas
        LocalTime horaSalida = LocalTime.parse(horaSalidaStr, HORA_FORMAT);
        LocalTime horaLlegada = LocalTime.parse(horaLlegadaStr, HORA_FORMAT);

        // Parsear capacidad (puede venir como 0300 → 300)
        int capacidad = Integer.parseInt(capacidadStr);

        // Calcular distancia usando Haversine
        double distancia = origen.getDistanciaA(destino);

        // Calcular duración
        Duration duracion = Duration.between(horaSalida, horaLlegada);
        if (duracion.isNegative()) {
            duracion = duracion.plusHours(24); // Vuelo cruza medianoche
        }

        // Generar ID del vuelo
        String id = String.format("VL-%s-%s-%04d", origenICAO, destinoICAO, numero);

        Vuelo vuelo = new Vuelo();
        vuelo.setId(id);
        vuelo.setAeropuertoOrigen(origen);
        vuelo.setAeropuertoDestino(destino);
        vuelo.setHoraSalida(horaSalida);
        vuelo.setHoraLlegada(horaLlegada);
        vuelo.setCapacidad(capacidad);
        vuelo.setDistancia(distancia);
        vuelo.setDuracion(duracion);

        return vuelo;
    }
}

