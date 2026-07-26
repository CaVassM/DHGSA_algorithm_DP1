-- Preparación del escenario "Operaciones día a día".
--
-- El enunciado pide dos cambios antes de empezar la prueba y su vuelta atrás al
-- terminar, ambos "usando un esquema manual en lote (script)". Este archivo
-- cubre los dos sentidos; se ejecuta el bloque que toque.
--
-- Uso (con los contenedores levantados):
--
--   docker exec -i tasf-b2b-postgres psql -U tasf -d tasf_b2b \
--     -f - < scripts/preparar-dia-a-dia.sql
--
-- o, si se prefiere pegar el bloque a mano:
--
--   docker exec -it tasf-b2b-postgres psql -U tasf -d tasf_b2b
--
-- IMPORTANTE: tras tocar la BD hay que reiniciar la operación día a día
-- (POST /api/v1/daily/reset, o el botón "Reiniciar operación" de la pantalla).
-- El servicio mantiene el grafo en memoria y no se entera solo de los cambios.


-- ---------------------------------------------------------------------------
-- 1. PREPARACIÓN — antes de la prueba
-- ---------------------------------------------------------------------------

-- 1.a  NO se borra la tabla de envíos.
--
--      El enunciado dice que "la tabla de envíos debe estar limpia", pero eso
--      describe un diseño donde el día a día lee de esa tabla. En esta solución
--      no la toca: DailyOperationService solo carga aeropuertos y vuelos, y
--      mantiene sus envíos en memoria (se reinician con POST /api/v1/daily/reset
--      o el botón "Reiniciar operación").
--
--      Borrarla, por tanto, no cambia nada para el día a día y sí destruye los
--      datos de las simulaciones 5D y de colapso. Como en la sesión de prueba se
--      demuestran los tres escenarios sobre el mismo despliegue, se dejan estar.
--
--      Si aun así se quiere la tabla vacía para enseñarla, hay que hacer copia
--      antes: recargar 158k envíos desde los .txt tarda bastante.
--
--        pg_dump -U tasf -d tasf_b2b -t envios -t rutas -t ruta_legs \
--                -t planning_runs --data-only > backup-envios.sql
--
--        DELETE FROM ruta_legs;
--        DELETE FROM rutas;
--        DELETE FROM planning_runs;
--        DELETE FROM envios;

-- 1.b  Capacidad de almacén a 999 en los cuatro aeropuertos de la prueba.
--      Lima, Buenos Aires, Copenhague y Delhi son los mostradores desde los que
--      registran los estudiantes; con su capacidad real se saturarían durante la
--      sesión y los rechazos taparían lo que se quiere observar.
UPDATE aeropuertos SET capacidad_almacen = 999
 WHERE codigo_icao IN ('SPIM', 'SABE', 'EKCH', 'VIDP');

-- Comprobación
SELECT codigo_icao, ciudad, gmt, capacidad_almacen
  FROM aeropuertos
 WHERE codigo_icao IN ('SPIM', 'SABE', 'EKCH', 'VIDP')
 ORDER BY codigo_icao;


-- 1.c  Planes de vuelo adicionales.
--
--      No se descargan: el enunciado da una plantilla de 48 vuelos con las horas
--      como HO/HD, a ajustar según la hora de la presentación. El generador está
--      en scripts/generar-vuelos-dia-a-dia.py; se le pasa la hora de inicio en
--      hora de Lima y se carga el archivo resultante:
--
--        python scripts/generar-vuelos-dia-a-dia.py 11:00 -o vuelos-prueba.txt
--        curl -X POST http://localhost:8080/api/v1/admin/imports/flights \
--             -F "file=@vuelos-prueba.txt"
--
--      Se añaden a los 2.866 existentes (upsert por businessId), no los
--      reemplazan. Se reconocen por capacidad = 150, que es la de la plantilla.


-- ---------------------------------------------------------------------------
-- 2. VUELTA ATRÁS — al terminar la prueba
-- ---------------------------------------------------------------------------
-- Descomentar y ejecutar solo esta parte cuando la prueba esté conforme.
--
-- Capacidades originales, según el enunciado.
--
-- UPDATE aeropuertos SET capacidad_almacen = 440 WHERE codigo_icao = 'SPIM';
-- UPDATE aeropuertos SET capacidad_almacen = 460 WHERE codigo_icao = 'SABE';
-- UPDATE aeropuertos SET capacidad_almacen = 480 WHERE codigo_icao = 'EKCH';
-- UPDATE aeropuertos SET capacidad_almacen = 480 WHERE codigo_icao = 'VIDP';
--
-- Los planes de vuelo añadidos se distinguen por capacidad 150 (la de la
-- plantilla del enunciado) y por salir de una de las cuatro sedes. Ningún vuelo
-- del dataset original cumple ambas cosas: sus capacidades van de 300 a 480.
--
-- DELETE FROM vuelos
--  WHERE capacidad = 150
--    AND business_id ~ '^VL-(SPIM|SABE|EKCH|VIDP)-';
--
-- Comprobación de la vuelta atrás: deben quedar 2.866 vuelos.
--
-- SELECT count(*) AS vuelos FROM vuelos;
-- SELECT codigo_icao, capacidad_almacen FROM aeropuertos
--  WHERE codigo_icao IN ('SPIM','SABE','EKCH','VIDP') ORDER BY codigo_icao;
