import ee
ee.Initialize(project='tu-proyecto-gcp')
 
aoi = ee.FeatureCollection('users/TU_USUARIO/aoi_lima_norte').geometry()
 
def mask_s2_clouds(image):
    qa = image.select('QA60')
    cloud_mask = qa.bitwiseAnd(1 << 10).eq(0).And(qa.bitwiseAnd(1 << 11).eq(0))
    return image.updateMask(cloud_mask).divide(10000)
 
def get_sentinel2_composite(year, aoi, cloud_pct=60):
    start, end = f'{year}-01-01', f'{year}-12-31'
    return (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(aoi)
        .filterDate(start, end)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloud_pct))
        .map(mask_s2_clouds)
        .select(['B2','B3','B4','B8','B11','B12'])
        .reduce(ee.Reducer.percentile([10]))
        .rename(['B2','B3','B4','B8','B11','B12'])
        .clip(aoi))
 
s2_2017 = get_sentinel2_composite(2017, aoi)
s2_2023 = get_sentinel2_composite(2023, aoi)
 
def export_to_drive(image, name, aoi, scale=10):
    task = ee.batch.Export.image.toDrive(
        image=image, description=name, folder='urban_pred_gee',
        fileNamePrefix=name, region=aoi, scale=scale,
        crs='EPSG:32718', maxPixels=1e13)
    task.start()
    return task
 
export_to_drive(s2_2017, 'S2_composite_2017_LimaNorte', aoi)
export_to_drive(s2_2023, 'S2_composite_2023_LimaNorte', aoi)

