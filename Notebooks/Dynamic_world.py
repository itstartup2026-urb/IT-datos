// ================================
// 1. ÁREA
// ================================
var region = ee.FeatureCollection(
  'projects/my-project-amaz-475816/assets/lima_norte'
).geometry();

Map.centerObject(region, 11);

// ================================
// 2. PERÍODO
// ================================
var START = '2023-01-01';
var END   = '2024-01-01';

// ================================
// 3. DYNAMIC WORLD
// ================================
var dw = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
  .filterBounds(region)
  .filterDate(START, END);

// ================================
// 4. CLASIFICACIÓN
// ================================
// opción robusta para ruido climático
var label = dw.select('label')
  .mode()
  .clip(region);

// ================================
// 5. VISUALIZACIÓN
// ================================
var palette = [
  '419bdf', // water
  '397d49', // trees
  '88b053', // grass
  '7a87c6', // flooded vegetation
  'e49635', // crops
  'dfc35a', // shrub
  'c4281b', // built
  'a59b8f', // bare
  'b39fe1'  // snow
];

Map.addLayer(label, {min: 0, max: 8, palette: palette}, 'DW Lima Norte');

// Validación
print('Número de imágenes DW:', dw.size());

// ================================
// 6. EXPORTAR
// ================================
Export.image.toDrive({
  image: label,
  description: 'DW_LimaNorte_2023',
  folder: 'GEE_exports',
  fileNamePrefix: 'DW_LimaNorte_2023',
  region: region,
  scale: 10,
  maxPixels: 1e13
});