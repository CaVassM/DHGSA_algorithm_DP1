package com.tasfb2b.dhgs.demo.application.dto;

import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.InstanciaVuelo;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * DTO que representa la ruta asignada a un envío.
 */
@Getter
@NoArgsConstructor(access = AccessLevel.PRIVATE)
public class RutaDTO {

    private String envioId;
    private String origenICAO;
    private String destinoICAO;
    private int cantidadMaletas;
    private List<String> vuelos = new ArrayList<>();  // Ej: ["SKBO→SPIM 03:34", "SPIM→SCEL 08:00"]
    private double distanciaKm;
    private long retrasoMinutos;
    private boolean factible;
    private int escalas;

    // Campos estructurados (mismo shape que RouteResponse, el DTO del endpoint
    // REST /planner/runs/{id}/routes) para que el mapa pueda dibujar la ruta
    // directamente desde el evento EPOCA por WebSocket, sin esperar a que
    // PlanningRoutePersistenceService la persista de forma asíncrona. Esa
    // persistencia va (a propósito) por detrás de la animación, así que si el
    // mapa dependiera solo de la BD, la primera época en particular llegaba sin
    // rutas que dibujar.
    private String origenIcao;
    private String destinoIcao;
    private LocalDateTime tiempoInicio;
    private LocalDateTime tiempoLlegadaEstimado;
    private double distanciaTotal;
    private boolean esDirecta;
    private List<String> flightBusinessIds = new ArrayList<>();

    public static RutaDTO from(Envio envio, RutaEnvio ruta) {
        RutaDTO dto = new RutaDTO();
        dto.envioId = envio.getId();
        dto.origenICAO = envio.getAeropuertoOrigen() != null ? envio.getAeropuertoOrigen().getCodigoICAO() : null;
        dto.destinoICAO = envio.getAeropuertoDestino() != null ? envio.getAeropuertoDestino().getCodigoICAO() : null;
        dto.cantidadMaletas = envio.getCantidadMaletas();
        dto.origenIcao = dto.origenICAO;
        dto.destinoIcao = dto.destinoICAO;

        if (ruta != null) {
            ruta.calcularTiempos();
            dto.distanciaKm = ruta.getDistanciaTotal();
            dto.retrasoMinutos = ruta.getRetraso();
            dto.factible = ruta.esFactible();
            dto.escalas = ruta.getEscalas();
            dto.tiempoInicio = ruta.getTiempoInicio();
            dto.tiempoLlegadaEstimado = ruta.getTiempoLlegadaEstimado();
            dto.distanciaTotal = ruta.getDistanciaTotal();
            dto.esDirecta = ruta.isEsDirecta();

            if (ruta.getSecuenciaVuelos() != null) {
                dto.vuelos = ruta.getSecuenciaVuelos().stream()
                        .map(RutaDTO::describirVuelo)
                        .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
                dto.flightBusinessIds = ruta.getSecuenciaVuelos().stream()
                        .map(RutaDTO::businessIdDeVuelo)
                        .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
            }
        }

        return dto;
    }

    /**
     * Id de plantilla de un vuelo. Las instancias fechadas por GrafoVuelos
     * llevan el id como {@code businessId@fechaHoraSalida}; en el catálogo del
     * front solo existe la plantilla, así que hay que recortar el sufijo (igual
     * que {@code PlanningRoutePersistenceService.businessIdDeVuelo}).
     */
    private static String businessIdDeVuelo(Vuelo vuelo) {
        String id = vuelo.getId();
        if (id == null) return null;
        int idx = id.indexOf('@');
        return idx > 0 ? id.substring(0, idx) : id;
    }

    private static String describirVuelo(Vuelo vuelo) {
        String origen = vuelo.getAeropuertoOrigen() != null ? vuelo.getAeropuertoOrigen().getCodigoICAO() : "N/A";
        String destino = vuelo.getAeropuertoDestino() != null ? vuelo.getAeropuertoDestino().getCodigoICAO() : "N/A";

        if (vuelo instanceof InstanciaVuelo instancia && instancia.getFechaHoraSalida() != null) {
            return origen + "→" + destino + " " + instancia.getFechaHoraSalida();
        }
        return origen + "→" + destino + " " + vuelo.getHoraSalida();
    }
}

