// ==================================================================================
// SCRIPT GEE 01 — ÍNDICES ESPECTRALES ARMONIZADOS S2/L8  [v2 — alineado con matriz]
// Variables: NDVI_MEAN/STD, BSI_MEAN/STD, MNDWI_MEAN/STD, EVI_MEAN/STD,
//            DELTA_NDVI, DELTA_BSI, FUENTE_SENSOR
// Años: 2017–2024 | Unidad: grilla 100×100 m Lima Norte
// Salida: CSVs anuales + 1 CSV de deltas en Drive (carpeta GEE_LimaNorte_CSV)
// ==================================================================================
// CAMBIOS RESPECTO A v1:
//   - Agregado EVI (más robusto que NDVI en presencia de aerosoles y lomas)
//   - Agregado STD de todos los índices (variabilidad intracelda)
//   - Agregado DELTA_NDVI y DELTA_BSI (cambio espectral 2017→2023)
//   - Reducer: mean() + stdDev() combinados
// ==================================================================================

var ASSET_GRILLA = 'projects/TU_PROYECTO/assets/grilla_distritos'; // ← CAMBIAR
var CARPETA_DRIVE = 'GEE_LimaNorte_CSV';
var CRS_SALIDA    = 'EPSG:32718';
var ANIOS         = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
var ANIOS_S2      = [2019, 2020, 2021, 2022, 2023, 2024];
var ANIOS_L8      = [2017, 2018];

var grilla = ee.FeatureCollection(ASSET_GRILLA);
var roi    = grilla.geometry().dissolve();

// ── ENMASCARAMIENTO ────────────────────────────────────────────────────────────
function maskS2(img) {
  var qa = img.select('QA60');
  return img.updateMask(qa.bitwiseAnd(1<<10).eq(0).and(qa.bitwiseAnd(1<<11).eq(0)))
            .divide(10000).copyProperties(img, ['system:time_start']);
}
function maskL8(img) {
  var qa = img.select('QA_PIXEL');
  return img.updateMask(qa.bitwiseAnd(1<<3).eq(0).and(qa.bitwiseAnd(1<<4).eq(0)))
            .multiply(0.0000275).add(-0.2).max(0).min(1)
            .copyProperties(img, ['system:time_start']);
}

// ── CÁLCULO DE ÍNDICES ─────────────────────────────────────────────────────────
function calcularIndices(img, sensor) {
  var BLUE  = sensor==='S2' ? img.select('B2')  : img.select('SR_B2');
  var GREEN = sensor==='S2' ? img.select('B3')  : img.select('SR_B3');
  var RED   = sensor==='S2' ? img.select('B4')  : img.select('SR_B4');
  var NIR   = sensor==='S2' ? img.select('B8')  : img.select('SR_B5');
  var SWIR  = sensor==='S2' ? img.select('B11') : img.select('SR_B6');

  // NDVI: vegetación normalizada
  var NDVI  = NIR.subtract(RED).divide(NIR.add(RED)).rename('NDVI');

  // BSI: suelo desnudo — reemplaza NDBI para clima árido limeño
  var BSI   = SWIR.add(RED).subtract(NIR.add(BLUE))
                  .divide(SWIR.add(RED).add(NIR).add(BLUE)).rename('BSI');

  // MNDWI: agua superficial (ríos, lagunas)
  var MNDWI = GREEN.subtract(SWIR).divide(GREEN.add(SWIR)).rename('MNDWI');

  // EVI: vegetación mejorada — más robusto con aerosoles y lomas estacionales de Ancón
  // EVI = 2.5 × (NIR - RED) / (NIR + 6×RED - 7.5×BLUE + 1)
  var EVI   = NIR.subtract(RED).multiply(2.5)
                 .divide(NIR.add(RED.multiply(6)).subtract(BLUE.multiply(7.5)).add(1))
                 .rename('EVI');

  return img.addBands([NDVI, BSI, MNDWI, EVI]);
}

// ── CALIBRACIÓN CRUZADA L8 → S2 ───────────────────────────────────────────────
var INDICES_CALIBRAR = ['NDVI', 'BSI', 'MNDWI', 'EVI'];

function construirCoeficientes() {
  var coefs = {};
  INDICES_CALIBRAR.forEach(function(idx) {
    var pares = ee.ImageCollection(ANIOS_S2.map(function(yr) {
      var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(roi).filterDate(yr+'-01-01', yr+'-12-31')
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50))
        .map(maskS2).map(function(i){return calcularIndices(i,'S2');})
        .select(idx).median().reproject({crs:CRS_SALIDA, scale:30});
      var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
        .filterBounds(roi).filterDate(yr+'-01-01', yr+'-12-31')
        .filter(ee.Filter.lt('CLOUD_COVER', 50))
        .map(maskL8).map(function(i){return calcularIndices(i,'L8');})
        .select(idx).median();
      return s2.rename('S2').addBands(l8.rename('L8'));
    }));
    var lr = pares.select(['L8','S2']).reduce(ee.Reducer.linearFit());
    coefs[idx] = {escala: lr.select('scale'), offset: lr.select('offset')};
  });
  return coefs;
}

// ── COMPOSITES ANUALES ─────────────────────────────────────────────────────────
function getCompositeS2(year) {
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(roi).filterDate(year+'-01-01', year+'-12-31')
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50))
    .map(maskS2).map(function(i){return calcularIndices(i,'S2');})
    .select(['NDVI','BSI','MNDWI','EVI']);
}
function getCompositeL8(year) {
  return ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterBounds(roi).filterDate(year+'-01-01', year+'-12-31')
    .filter(ee.Filter.lt('CLOUD_COVER', 50))
    .map(maskL8).map(function(i){return calcularIndices(i,'L8');})
    .select(['NDVI','BSI','MNDWI','EVI']);
}
function armonizarL8(colL8, coefs) {
  return ee.ImageCollection(INDICES_CALIBRAR.map(function(idx) {
    return colL8.select(idx).map(function(img) {
      return img.multiply(coefs[idx].escala).add(coefs[idx].offset).rename(idx);
    });
  }).reduce(function(a, b) { return a.combine(b); }));
}

// ── EXTRACCIÓN + EXPORTACIÓN ANUAL ────────────────────────────────────────────
var coefs = construirCoeficientes();
var reducer = ee.Reducer.mean().combine({
  reducer2: ee.Reducer.stdDev(), sharedInputs: true
});

// Almacenar mediana anual para deltas
var compuestos = {};

ANIOS.forEach(function(year) {
  var esS2     = ANIOS_S2.indexOf(year) >= 0;
  var coleccion = esS2 ? getCompositeS2(year) : armonizarL8(getCompositeL8(year), coefs);
  var mediana  = coleccion.median().clip(roi);
  compuestos[year] = mediana;

  var sensor   = ee.Image.constant(esS2 ? 1 : 0).rename('FUENTE_SENSOR').toInt8();
  var imagen   = mediana.addBands(sensor);

  var ext = imagen.reduceRegions({
    collection: grilla, reducer: reducer, scale: 10, crs: CRS_SALIDA
  });

  ext = ext.map(function(feat) {
    return feat.set({
      'NDVI_MEAN'  : feat.get('NDVI_mean'),
      'NDVI_STD'   : feat.get('NDVI_stdDev'),
      'BSI_MEAN'   : feat.get('BSI_mean'),
      'BSI_STD'    : feat.get('BSI_stdDev'),
      'MNDWI_MEAN' : feat.get('MNDWI_mean'),
      'MNDWI_STD'  : feat.get('MNDWI_stdDev'),
      'EVI_MEAN'   : feat.get('EVI_mean'),
      'EVI_STD'    : feat.get('EVI_stdDev'),
      'FUENTE_SENSOR': feat.get('FUENTE_SENSOR'),
      'ANIO'       : year
    });
  });

  var campos = ['cell_id','col_idx','row_idx','fold_id','ubigeo','distrito',
                'NDVI_MEAN','NDVI_STD','BSI_MEAN','BSI_STD',
                'MNDWI_MEAN','MNDWI_STD','EVI_MEAN','EVI_STD',
                'FUENTE_SENSOR','ANIO'];

  Export.table.toDrive({
    collection: ext.select(campos),
    description: 'LN_IndicesEspectrales_' + year,
    folder: CARPETA_DRIVE,
    fileNamePrefix: 'LN_IndicesEspectrales_' + year,
    fileFormat: 'CSV'
  });
});

// ── DELTA ESPECTRAL: 2017 → 2023 ──────────────────────────────────────────────
// DELTA_NDVI y DELTA_BSI capturan la transición espectral del periodo analizado.
// Se usa 2017 como t0 (L8 armonizado) y 2023 como t1 (S2 nativo).
// El script espera que compuestos[2017] y compuestos[2023] ya estén calculados.
var delta_NDVI = compuestos[2023].select('NDVI')
                   .subtract(compuestos[2017].select('NDVI'))
                   .rename('DELTA_NDVI');
var delta_BSI  = compuestos[2023].select('BSI')
                   .subtract(compuestos[2017].select('BSI'))
                   .rename('DELTA_BSI');

var deltaImg = delta_NDVI.addBands(delta_BSI);

var extDelta = deltaImg.reduceRegions({
  collection: grilla,
  reducer: ee.Reducer.mean(),
  scale: 10,
  crs: CRS_SALIDA
});

extDelta = extDelta.map(function(feat) {
  return feat.set({
    'DELTA_NDVI': feat.get('DELTA_NDVI'),
    'DELTA_BSI' : feat.get('DELTA_BSI')
  });
});

Export.table.toDrive({
  collection: extDelta.select(['cell_id','col_idx','row_idx','fold_id',
                                'ubigeo','distrito','DELTA_NDVI','DELTA_BSI']),
  description: 'LN_DeltaEspectral_2017_2023',
  folder: CARPETA_DRIVE,
  fileNamePrefix: 'LN_DeltaEspectral_2017_2023',
  fileFormat: 'CSV'
});

// ── VERIFICACIÓN VISUAL ────────────────────────────────────────────────────────
Map.centerObject(roi, 11);
Map.addLayer(roi, {color:'black'}, 'Lima Norte AOI');
Map.addLayer(grilla.style({fillColor:'00000000', color:'gray', width:0.3}), {}, 'Grilla 100m');
Map.addLayer(compuestos[2023].select('NDVI'),
             {min:-0.1, max:0.6, palette:['brown','yellow','green']}, 'NDVI 2023');
Map.addLayer(compuestos[2023].select('EVI'),
             {min:-0.1, max:0.5, palette:['brown','yellow','darkgreen']}, 'EVI 2023', false);
Map.addLayer(delta_NDVI,
             {min:-0.3, max:0.3, palette:['red','white','green']}, 'DELTA_NDVI (2017→2023)', false);

print('Script 01 v2 — Índices espectrales [ALINEADO CON MATRIZ]');
print('Variables exportadas por año: NDVI/BSI/MNDWI/EVI (MEAN+STD) + FUENTE_SENSOR');
print('CSVs anuales: ' + ANIOS.length + ' exportaciones');
print('CSV adicional: LN_DeltaEspectral_2017_2023 (DELTA_NDVI, DELTA_BSI)');
print('Total tareas: ' + (ANIOS.length + 1));
