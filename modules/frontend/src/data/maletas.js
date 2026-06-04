export const MALETAS_POR_AEROPUERTO = {
  GRU: [
    { codigo: 'TB2B-P9P5TT', destino: 'PEK', estado: 'EN PLAZO',       horasRestantes:  46 },
    { codigo: 'TB2B-578WX0', destino: 'LHR', estado: 'FUERA DE PLAZO', horasRestantes:  -4 },
    { codigo: 'TB2B-HK2VVE', destino: 'HND', estado: 'EN PLAZO',       horasRestantes:  56 },
    { codigo: 'TB2B-GZ5UXA', destino: 'MEX', estado: 'EN RIESGO',      horasRestantes:   4 },
    { codigo: 'TB2B-PH24E4', destino: 'FRA', estado: 'EN PLAZO',       horasRestantes:  14 },
    { codigo: 'TB2B-T388VR', destino: 'MAD', estado: 'EN PLAZO',       horasRestantes:  28 },
    { codigo: 'TB2B-710ZQ8', destino: 'JFK', estado: 'FUERA DE PLAZO', horasRestantes:  -2 },
    { codigo: 'TB2B-M44KPX', destino: 'DXB', estado: 'EN PLAZO',       horasRestantes:  32 },
    { codigo: 'TB2B-R7QBNW', destino: 'LHR', estado: 'EN PLAZO',       horasRestantes:  20 },
    { codigo: 'TB2B-C9JLTT', destino: 'HND', estado: 'EN RIESGO',      horasRestantes:   6 },
    { codigo: 'TB2B-YK3PAV', destino: 'FRA', estado: 'EN PLAZO',       horasRestantes:  48 },
    { codigo: 'TB2B-BWZXQ2', destino: 'MAD', estado: 'EN PLAZO',       horasRestantes:  10 },
  ],
  JFK: [
    { codigo: 'TB2B-AA1001', destino: 'LHR', estado: 'EN PLAZO',       horasRestantes:  12 },
    { codigo: 'TB2B-AA1002', destino: 'MAD', estado: 'EN RIESGO',      horasRestantes:   3 },
    { codigo: 'TB2B-AA1003', destino: 'FRA', estado: 'EN PLAZO',       horasRestantes:  24 },
    { codigo: 'TB2B-AA1004', destino: 'DXB', estado: 'FUERA DE PLAZO', horasRestantes:  -1 },
    { codigo: 'TB2B-AA1005', destino: 'PEK', estado: 'EN PLAZO',       horasRestantes:  36 },
  ],
  MEX: [
    { codigo: 'TB2B-MX2001', destino: 'MAD', estado: 'EN PLAZO',       horasRestantes:  18 },
    { codigo: 'TB2B-MX2002', destino: 'FRA', estado: 'EN RIESGO',      horasRestantes:   4 },
    { codigo: 'TB2B-MX2003', destino: 'LHR', estado: 'EN PLAZO',       horasRestantes:  30 },
    { codigo: 'TB2B-MX2004', destino: 'DXB', estado: 'FUERA DE PLAZO', horasRestantes:  -6 },
    { codigo: 'TB2B-MX2005', destino: 'GRU', estado: 'EN PLAZO',       horasRestantes:  22 },
    { codigo: 'TB2B-MX2006', destino: 'HND', estado: 'EN PLAZO',       horasRestantes:  44 },
  ],
  LHR: [
    { codigo: 'TB2B-LH3001', destino: 'DXB', estado: 'EN PLAZO',       horasRestantes:   8 },
    { codigo: 'TB2B-LH3002', destino: 'PEK', estado: 'EN RIESGO',      horasRestantes:   5 },
    { codigo: 'TB2B-LH3003', destino: 'JFK', estado: 'FUERA DE PLAZO', horasRestantes:  -3 },
    { codigo: 'TB2B-LH3004', destino: 'MAD', estado: 'EN PLAZO',       horasRestantes:  16 },
  ],
  FRA: [
    { codigo: 'TB2B-FR4001', destino: 'DXB', estado: 'EN PLAZO',       horasRestantes:  10 },
    { codigo: 'TB2B-FR4002', destino: 'HND', estado: 'EN PLAZO',       horasRestantes:  38 },
    { codigo: 'TB2B-FR4003', destino: 'PEK', estado: 'EN RIESGO',      horasRestantes:   2 },
  ],
  MAD: [
    { codigo: 'TB2B-MD5001', destino: 'GRU', estado: 'EN PLAZO',       horasRestantes:  26 },
    { codigo: 'TB2B-MD5002', destino: 'JFK', estado: 'EN PLAZO',       horasRestantes:  14 },
  ],
  DXB: [
    { codigo: 'TB2B-DB6001', destino: 'PEK', estado: 'EN PLAZO',       horasRestantes:  20 },
    { codigo: 'TB2B-DB6002', destino: 'HND', estado: 'EN RIESGO',      horasRestantes:   3 },
    { codigo: 'TB2B-DB6003', destino: 'LHR', estado: 'EN PLAZO',       horasRestantes:  40 },
  ],
  PEK: [
    { codigo: 'TB2B-PK7001', destino: 'HND', estado: 'EN PLAZO',       horasRestantes:  16 },
    { codigo: 'TB2B-PK7002', destino: 'DXB', estado: 'FUERA DE PLAZO', horasRestantes:  -2 },
    { codigo: 'TB2B-PK7003', destino: 'FRA', estado: 'EN PLAZO',       horasRestantes:  50 },
  ],
  HND: [
    { codigo: 'TB2B-HN8001', destino: 'FRA', estado: 'EN PLAZO',       horasRestantes:  22 },
    { codigo: 'TB2B-HN8002', destino: 'DXB', estado: 'EN RIESGO',      horasRestantes:   1 },
    { codigo: 'TB2B-HN8003', destino: 'PEK', estado: 'FUERA DE PLAZO', horasRestantes:  -5 },
  ],
}

export const VUELOS_DETALLE_POR_AEROPUERTO = {
  GRU: {
    salientes: [
      { codigo: 'FL-4492', hacia: 'DXB', saleEn: '2:57h', capacidadLibre: 208, asignadas: 236 },
    ],
    entrantes: [
      { codigo: 'FL-9744', desde: 'GRU', llegaEn: '0:12h', maletasEnCamino: 89 },
      { codigo: 'FL-4084', desde: 'HND', llegaEn: '0:56h', maletasEnCamino: 174 },
    ],
  },
  JFK: {
    salientes: [
      { codigo: 'FL-2461', hacia: 'LHR', saleEn: '3:00h', capacidadLibre: 155, asignadas: 45 },
    ],
    entrantes: [
      { codigo: 'FL-1021', desde: 'MAD', llegaEn: '2:30h', maletasEnCamino: 62 },
    ],
  },
  MEX: {
    salientes: [
      { codigo: 'FL-7519', hacia: 'MAD', saleEn: '0:00h', capacidadLibre: 49, asignadas: 131 },
      { codigo: 'FL-3148', hacia: 'MAD', saleEn: '8:00h', capacidadLibre: 26, asignadas: 224 },
    ],
    entrantes: [
      { codigo: 'FL-5512', desde: 'JFK', llegaEn: '1:45h', maletasEnCamino: 110 },
    ],
  },
  LHR: {
    salientes: [
      { codigo: 'FL-6613', hacia: 'DXB', saleEn: '1:20h', capacidadLibre: 80, asignadas: 170 },
    ],
    entrantes: [
      { codigo: 'FL-2461', desde: 'JFK', llegaEn: '4:00h', maletasEnCamino: 45 },
    ],
  },
  FRA: {
    salientes: [
      { codigo: 'FL-4523', hacia: 'HND', saleEn: '6:00h', capacidadLibre: 12, asignadas: 198 },
    ],
    entrantes: [
      { codigo: 'FL-8389', desde: 'GRU', llegaEn: '0:30h', maletasEnCamino: 132 },
    ],
  },
  MAD: {
    salientes: [
      { codigo: 'FL-1021', hacia: 'JFK', saleEn: '4:00h', capacidadLibre: 120, asignadas: 80 },
    ],
    entrantes: [
      { codigo: 'FL-7519', desde: 'MEX', llegaEn: '8:15h', maletasEnCamino: 131 },
    ],
  },
  DXB: {
    salientes: [
      { codigo: 'FL-9012', hacia: 'PEK', saleEn: '0:00h', capacidadLibre: 55, asignadas: 165 },
    ],
    entrantes: [
      { codigo: 'FL-3910', desde: 'GRU', llegaEn: '3:00h', maletasEnCamino: 200 },
    ],
  },
  PEK: {
    salientes: [
      { codigo: 'FL-7701', hacia: 'HND', saleEn: '2:00h', capacidadLibre: 90, asignadas: 130 },
    ],
    entrantes: [
      { codigo: 'FL-9012', desde: 'DXB', llegaEn: '1:30h', maletasEnCamino: 165 },
    ],
  },
  HND: {
    salientes: [
      { codigo: 'FL-4084', hacia: 'GRU', saleEn: '3:30h', capacidadLibre: 36, asignadas: 174 },
    ],
    entrantes: [
      { codigo: 'FL-4523', desde: 'FRA', llegaEn: '6:00h', maletasEnCamino: 198 },
    ],
  },
}
