def calcular_indices(image):
    ndvi = image.normalizedDifference(['B8','B4']).rename('NDVI')
    ndwi = image.normalizedDifference(['B8','B11']).rename('NDWI')
    mndwi = image.normalizedDifference(['B3','B11']).rename('MNDWI')
    evi = image.expression(
        '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))',
        {'NIR':image.select('B8'),'RED':image.select('B4'),'BLUE':image.select('B2')}
    ).rename('EVI')
    bsi = image.expression(
        '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))',
        {'SWIR1':image.select('B11'),'RED':image.select('B4'),
         'NIR':image.select('B8'),'BLUE':image.select('B2')}
    ).rename('BSI')
    ndbi = image.normalizedDifference(['B11','B8']).rename('NDBI')
    return image.addBands([ndvi, ndwi, mndwi, evi, bsi, ndbi])
 
s2_2017_idx = calcular_indices(s2_2017)
s2_2023_idx = calcular_indices(s2_2023)
 
delta_ndvi = s2_2023_idx.select('NDVI').subtract(s2_2017_idx.select('NDVI')).rename('DELTA_NDVI')
delta_bsi  = s2_2023_idx.select('BSI').subtract(s2_2017_idx.select('BSI')).rename('DELTA_BSI')
 
stack = (s2_2023_idx.select(['NDVI','MNDWI','EVI','BSI','NDBI'])
         .addBands([delta_ndvi, delta_bsi, viirs]))
export_to_drive(stack, 'IndicesEspectrales_2023_LimaNorte', aoi, scale=100)

