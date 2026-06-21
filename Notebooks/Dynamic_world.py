// =====================================================
// 1. ÁREA DE ESTUDIO: LIMA NORTE
// =====================================================
var region = ee.FeatureCollection(
  'projects/my-project-amaz-475816/assets/lima_norte'
).geometry();

Map.centerObject(region, 11);

// =====================================================
// 2. PERÍODO DE ANÁLISIS
// =====================================================
var START = '2023-01-01';
var END   = '2023-12-31';

// =====================================================
// 3. DYNAMIC WORLD
// =====================================================
var dw = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
  .filterBounds(region)
  .filterDate(START, END);

// Clase dominante (más frecuente) durante el período
var dwLabel = dw
  .select('label')
  .mode()
  .clip(region);

// =====================================================
// 4. VISUALIZACIÓN
// =====================================================
var VIS_PALETTE = [
  '419bdf', // water
  '397d49', // trees
  '88b053', // grass
  '7a87c6', // flooded vegetation
  'e49635', // crops
  'dfc35a', // shrub_and_scrub
  'c4281b', // built
  'a59b8f', // bare
  'b39fe1'  // snow_and_ice
];

Map.addLayer(
  dwLabel,
  {
    min: 0,
    max: 8,
    palette: VIS_PALETTE
  },
  'Dynamic World - Clase dominante'
);

// Mostrar límite de Lima Norte
Map.addLayer(
  region,
  {color: 'black'},
  'Límite Lima Norte',
  false
);

// =====================================================
// 5. EXPORTAR A GOOGLE DRIVE
// =====================================================
Export.image.toDrive({
  image: dwLabel,
  description: 'DynamicWorld_LimaNorte_2023',
  folder: 'GEE_exports', // opcional
  fileNamePrefix: 'DW_LimaNorte_2023',
  region: region,
  scale: 10,
  crs: 'EPSG:32718', // UTM 18S (Perú)
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF'
});