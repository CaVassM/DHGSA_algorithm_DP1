package com.tasfb2b.backend.controller;

import com.tasfb2b.backend.dto.response.AirportResponse;
import com.tasfb2b.backend.exception.ResourceNotFoundException;
import com.tasfb2b.backend.service.AirportService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.PageImpl;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(AirportController.class)
class AirportControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private AirportService airportService;

    @Test
    void list_returnsPagedAirports() throws Exception {
        AirportResponse a = new AirportResponse(1L, 1, "SKBO", "Bogota",
                "Colombia", "America del Sur", 430, 4.7, -74.14, -5);
        when(airportService.listAll(any())).thenReturn(new PageImpl<>(List.of(a)));

        mockMvc.perform(get("/api/v1/airports"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].codigoIcao").value("SKBO"));
    }

    @Test
    void getById_returnsNotFoundForUnknown() throws Exception {
        when(airportService.findById(999L))
                .thenThrow(new ResourceNotFoundException("Aeropuerto 999 no encontrado"));

        mockMvc.perform(get("/api/v1/airports/999"))
                .andExpect(status().isNotFound());
    }
}
