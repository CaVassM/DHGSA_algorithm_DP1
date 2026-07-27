#!/usr/bin/env python3
"""
Genera los planes de vuelo adicionales del escenario "Operaciones día a día".

El enunciado no entrega un archivo fijo: da una plantilla de 48 vuelos con las
horas marcadas como HO/HD, que cada equipo debe ajustar "según la hora de su
presentación". Este script hace ese ajuste.

Uso:

    python scripts/generar-vuelos-dia-a-dia.py 11:00
    python scripts/generar-vuelos-dia-a-dia.py 11:00 -o vuelos-prueba.txt

El argumento es la hora de inicio de la prueba EN HORA LOCAL DE LIMA (que es
donde se presenta). Sale por pantalla, o a un archivo con -o.

--- Sobre las horas ---

El formato de planes_vuelo.txt es ORIG-DEST-HH:MM-HH:MM-CCCC, con las horas en
hora LOCAL de cada aeropuerto. Restarlas sin más ("Duration.between" en
VueloParser) da duración + diferencia de husos, que es justo lo que el modelo
necesita para fechar las instancias de vuelo.

Se comprueba contra los vuelos reales del dataset:

    SPIM->SVMI  05:24 -> 09:50  = 4h26  (3h26 de vuelo + 1h de huso)
    SPIM->EBCI  08:07 -> 04:11  = 20h04 (13h de vuelo + 7h de huso)

De ahí la fórmula del enunciado, que es la que se aplica aquí:

    HD = HO + duración + (gmt_destino - gmt_origen)

Las duraciones salen de las reglas del enunciado: 6 h dentro de Sudamérica y
12 h fuera, para SPIM/SABE; 4 h dentro de Europa-Asia y 13 h fuera, para
EKCH/VIDP.

Nota: el Ejemplo 1 del enunciado trae el HO como 09:12 para una presentación de
las 11:00 — es una errata en el minuto. El profesor aclaró que la regla real es
minuto 15 para todos los vuelos ("todos parten en el minuto 15, luego de
iniciada la presentación"), sea cual sea la hora de inicio elegida; 09:15 en su
ejemplo es solo eso, un ejemplo con hora de inicio 09:00.
"""

import argparse
import sys

# Husos horarios, como están en la tabla aeropuertos.
GMT = {
    'SPIM': -5,  # Lima
    'SABE': -3,  # Buenos Aires
    'EKCH': +2,  # Copenhague
    'VIDP': +5,  # Delhi
    'SCEL': -3,  # Santiago de Chile
    'SVMI': -4,  # Caracas
    'SBBR': -3,  # Brasilia
    'SKBO': -5,  # Bogotá
    'SGAS': -4,  # Asunción
    'SUAA': -3,  # Montevideo
    'EBCI': +2,  # Bruselas
    'LBSF': +3,  # Sofía
    'OAKB': +4,  # Kabul
    'OPKC': +5,  # Karachi
    'EHAM': +2,  # Ámsterdam
    'OMDB': +4,  # Dubái
}

# Los 6 destinos "dentro" y los 6 "fuera", por sede. Del bloque del enunciado.
SUDAMERICA = ['SCEL', 'SVMI', 'SBBR', 'SKBO', 'SGAS', 'SUAA']
EUROPA_ASIA = ['EBCI', 'LBSF', 'OAKB', 'OPKC', 'EHAM', 'OMDB']

# Minutos que se suman a la hora de inicio para obtener la salida real
# (aclaración del profesor: "todos parten en el minuto 15, luego de iniciada
# la presentación"; el 09:12 del Ejemplo 1 era una errata, no la regla). Es
# una suma real sobre la hora ingresada, no un minuto de reloj fijo: si la
# prueba empieza a las 02:40, la salida es 02:55, no 02:15. Todos los
# destinos de una misma sede salen a esa misma hora — no hay escalonado por
# bloques.
MINUTOS_TRAS_INICIO = 15

CAPACIDAD = '0150'


def bloques():
    """(sede, destinos, duración, rótulo) para los 8 bloques del enunciado."""
    for sede in ('SPIM', 'SABE'):
        yield sede, SUDAMERICA, 6, f'Vuelos de origen en {sede} dentro de América del sur 6 horas.'
        yield sede, EUROPA_ASIA, 12, f'Vuelos de origen en {sede} fuera de América del sur 12 horas.'
    for sede in ('EKCH', 'VIDP'):
        yield sede, EUROPA_ASIA, 4, f'Vuelos de origen en {sede} dentro de Europa-Asia 4 horas.'
        yield sede, SUDAMERICA, 13, f'Vuelos de origen en {sede} fuera de Europa-Asia 13 horas.'


def generar(hora_lima, minuto_lima, comentarios):
    lineas = []
    total = 0

    # La salida real es MINUTOS_TRAS_INICIO minutos después de la hora
    # ingresada (suma real, con acarreo de hora si hace falta) — no un minuto
    # de reloj fijo.
    total_minutos = hora_lima * 60 + minuto_lima + MINUTOS_TRAS_INICIO
    hora_base = (total_minutos // 60) % 24
    minuto_base = total_minutos % 60

    for sede, destinos, duracion, rotulo in bloques():
        if comentarios:
            lineas.append(f'** {rotulo}')

        for destino in destinos:
            # HO en hora local de la sede: la prueba empieza a la misma hora
            # física en todas, así que se traslada desde la de Lima (ya con los
            # +15 min sumados). Todos los destinos de esta sede salen a esa
            # MISMA hora (sin escalonado). El minuto no cambia de HO a HD:
            # duración y diferencia de husos son horas enteras.
            ho = (hora_base + (GMT[sede] - GMT['SPIM'])) % 24
            # HD = HO + duración + diferencia de husos (fórmula del enunciado).
            hd = (ho + duracion + (GMT[destino] - GMT[sede])) % 24

            lineas.append(f'{sede}-{destino}-{ho:02d}:{minuto_base:02d}-{hd:02d}:{minuto_base:02d}-{CAPACIDAD}')
            total += 1

        if comentarios:
            lineas.append('**')

    return lineas, total


def main():
    p = argparse.ArgumentParser(
        description='Genera los planes de vuelo adicionales del escenario día a día.')
    p.add_argument('hora', help='Hora de inicio de la prueba, en hora de Lima. Formato HH:MM (p.ej. 11:00).')
    p.add_argument('-o', '--output', help='Archivo de salida. Por defecto, la pantalla.')
    p.add_argument('--comentarios', action='store_true',
                   help='Incluye las líneas "**" de rótulo. El cargador las ignora, '
                        'pero ayudan a revisar el archivo antes de subirlo.')
    args = p.parse_args()

    try:
        hh, mm = args.hora.split(':')
        hora_lima, minuto_lima = int(hh), int(mm)
        if not (0 <= hora_lima < 24 and 0 <= minuto_lima < 60):
            raise ValueError
    except ValueError:
        print(f'Hora inválida: {args.hora!r}. Se espera HH:MM en 24 h, por ejemplo 11:00.',
              file=sys.stderr)
        return 1

    lineas, total = generar(hora_lima, minuto_lima, args.comentarios)
    texto = '\n'.join(lineas) + '\n'

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(texto)
        print(f'{total} vuelos escritos en {args.output} '
              f'(prueba a las {args.hora} hora de Lima).', file=sys.stderr)
    else:
        print(texto, end='')

    return 0


if __name__ == '__main__':
    sys.exit(main())