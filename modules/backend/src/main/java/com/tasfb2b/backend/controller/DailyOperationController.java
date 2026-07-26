package com.tasfb2b.backend.controller;

import com.tasfb2b.backend.dto.request.DailyRegisterRequest;
import com.tasfb2b.backend.dto.response.DailyBulkUploadResponse;
import com.tasfb2b.backend.dto.response.DailyCancelResponse;
import com.tasfb2b.backend.dto.response.DailyShipmentRouteResponse;
import com.tasfb2b.backend.dto.response.DailyCloseReportResponse;
import com.tasfb2b.backend.dto.response.DailyRegisterResponse;
import com.tasfb2b.backend.dto.response.DailyStateResponse;
import com.tasfb2b.backend.service.DailyOperationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Operación día a día (escenario REAL_TIME): registro manual de envíos uno a
 * uno con descuento de capacidad en vivo. Pantalla independiente del simulador
 * de periodo; no corre el optimizador ni replanifica.
 */
@RestController
@RequestMapping("/api/v1/daily")
@RequiredArgsConstructor
@Tag(name = "Operación día a día",
        description = "Registro manual de envíos en tiempo real con capacidades que se llenan en línea hasta el colapso.")
public class DailyOperationController {

    private final DailyOperationService dailyOperationService;

    @PostMapping("/shipments")
    @Operation(summary = "Registrar un envío manual",
            description = "Valida que exista ruta de vuelos con capacidad y la descuenta en vivo. "
                    + "Si no hay cupo, rechaza (indicio de colapso).")
    public ResponseEntity<DailyRegisterResponse> registrar(@Valid @RequestBody DailyRegisterRequest request) {
        DailyRegisterResponse response = dailyOperationService.registrar(request);
        return response.isAceptado()
                ? ResponseEntity.ok(response)
                : ResponseEntity.unprocessableEntity().body(response);
    }

    @GetMapping("/state")
    @Operation(summary = "Estado actual de las capacidades de la flota",
            description = "Muestra cómo se van llenando los vuelos y si se alcanzó el colapso total.")
    public ResponseEntity<DailyStateResponse> estado() {
        return ResponseEntity.ok(dailyOperationService.estado());
    }

    @GetMapping("/shipments")
    @Operation(summary = "Envíos registrados con su ruta",
            description = "Lista los envíos aceptados con los tramos que siguen, cada uno con sus "
                    + "horas en UTC y en la hora local de su aeropuerto. Es lo que el mapa necesita "
                    + "para dibujar gráficamente todas las rutas de un envío. Un envío reasignado "
                    + "tras una cancelación aparece con la ruta que realmente sigue.")
    public ResponseEntity<List<DailyShipmentRouteResponse>> enviosConRuta() {
        return ResponseEntity.ok(dailyOperationService.enviosConRuta());
    }

    @PostMapping("/shipments/upload")
    @Operation(summary = "Cargar un archivo de envíos",
            description = "Registra en lote los envíos de un archivo de texto con el formato de la "
                    + "data histórica (id-AAAAMMDD-HH-mm-DESTINO-maletas-cliente). Cada línea pasa "
                    + "por el mismo registro que un envío manual: valida ruta, descuenta capacidad y "
                    + "aplica el huso del aeropuerto. La fecha y hora se leen como hora local del "
                    + "origen.")
    public ResponseEntity<DailyBulkUploadResponse> cargarArchivo(
            @RequestParam String origenIcao,
            @RequestParam("file") MultipartFile file
    ) throws IOException {
        String contenido = new String(file.getBytes(), StandardCharsets.UTF_8);
        return ResponseEntity.ok(
                dailyOperationService.cargarLote(origenIcao.trim().toUpperCase(), contenido));
    }

    @PostMapping("/flights/{idVuelo}/cancel")
    @Operation(summary = "Cancelar un vuelo y reasignar sus maletas",
            description = "P&R P9: cancela la próxima salida del vuelo que despegue con al menos una "
                    + "hora de margen y busca ruta alternativa para cada envío que la usaba. La "
                    + "reasignación es inmediata (la operación es continua, no hay épocas). Devuelve "
                    + "qué envíos se recolocaron y cuáles quedaron sin ruta.")
    public ResponseEntity<DailyCancelResponse> cancelarVuelo(@PathVariable String idVuelo) {
        DailyCancelResponse respuesta = dailyOperationService.cancelarVuelo(idVuelo);
        return respuesta.isAplicada()
                ? ResponseEntity.ok(respuesta)
                : ResponseEntity.unprocessableEntity().body(respuesta);
    }

    @PostMapping("/close")
    @Operation(summary = "Cerrar las operaciones del día",
            description = "G09: congela la jornada y devuelve el reporte de la última planificación "
                    + "estable: totales, cumplimiento, estado final de la flota y detalle de envíos "
                    + "atendidos y rechazados. Tras el cierre no se admiten más registros hasta reiniciar.")
    public ResponseEntity<DailyCloseReportResponse> cerrar() {
        return ResponseEntity.ok(dailyOperationService.cerrar());
    }

    @GetMapping("/close")
    @Operation(summary = "Consultar el reporte de cierre de la jornada",
            description = "Devuelve el reporte de la última jornada cerrada, o 204 si sigue abierta. "
                    + "Permite que otro visualizador lo consulte sin volver a cerrarla.")
    public ResponseEntity<DailyCloseReportResponse> reporteCierre() {
        DailyCloseReportResponse reporte = dailyOperationService.ultimoCierre();
        return reporte != null
                ? ResponseEntity.ok(reporte)
                : ResponseEntity.noContent().build();
    }

    @PostMapping("/reset")
    @Operation(summary = "Reiniciar la operación día a día",
            description = "Recarga aeropuertos y vuelos desde la BD con capacidad a tope, borra los "
                    + "registros y descarta el reporte de cierre para abrir una jornada nueva.")
    public ResponseEntity<DailyStateResponse> reiniciar() {
        dailyOperationService.reiniciar();
        return ResponseEntity.ok(dailyOperationService.estado());
    }
}
