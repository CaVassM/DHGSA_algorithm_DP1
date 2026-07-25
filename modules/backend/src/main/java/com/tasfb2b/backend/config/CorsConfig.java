package com.tasfb2b.backend.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    /**
     * G06: orígenes autorizados a llamar a la API.
     *
     * <p>Antes la lista estaba fija en el código (localhost y 127.0.0.1). Con
     * eso, un segundo visualizador abierto desde otro equipo de la red — que
     * llega con origen {@code http://192.168.x.x:5173} — era rechazado por CORS
     * en todas las llamadas REST, así que no podían conectarse dos dispositivos
     * contra un mismo planificador.
     *
     * <p>Ahora es configurable. El valor por defecto {@code *} deja pasar
     * cualquier origen, que es lo que hace falta en el laboratorio: las IPs de
     * los equipos cambian y no se pueden enumerar de antemano.
     *
     * <p><b>En un despliegue público (AWS) hay que acotarlo.</b> Con {@code *}
     * más {@code allowCredentials}, cualquier página web podría llamar a esta
     * API desde el navegador de un usuario. Se restringe por configuración, sin
     * tocar código:
     *
     * <pre>
     * tasfb2b.cors.allowed-origins=https://tasfb2b.midominio.com
     * </pre>
     *
     * o por variable de entorno {@code TASFB2B_CORS_ALLOWED_ORIGINS}. Acepta
     * varios separados por coma y comodines ({@code https://*.midominio.com}).
     *
     * <p>Nota: si el visualizador se sirve por el MISMO dominio que la API
     * (proxy o ALB enrutando /api), las llamadas dejan de ser cross-origin y
     * CORS ni siquiera interviene.
     */
    @Value("${tasfb2b.cors.allowed-origins:*}")
    private String[] allowedOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                // allowedOriginPatterns (no allowedOrigins) porque con
                // allowCredentials(true) Spring prohíbe el comodín en la lista
                // literal de orígenes.
                .allowedOriginPatterns(allowedOrigins)
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .exposedHeaders("Location")
                .allowCredentials(true)
                .maxAge(3600);
    }
}
