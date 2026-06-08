import geopandas as gpd
import json
from pathlib import Path
from shapely.validation import make_valid
 
SHP_PATH   = Path('data/vectors/lima_norte.shp')
CRS_MODELO = 'EPSG:32718'
OUT_DIR    = Path('data/processed')
OUT_DIR.mkdir(parents=True, exist_ok=True)
 
aoi = gpd.read_file(SHP_PATH)
if aoi.crs.to_epsg() != 32718:
    aoi = aoi.to_crs(CRS_MODELO)
 
invalidas = (~aoi.geometry.is_valid).sum()
if invalidas > 0:
    aoi.geometry = aoi.geometry.apply(make_valid)
 
if len(aoi) > 1:
    aoi = aoi.dissolve()
aoi['nombre_aoi'] = 'Lima_Norte'
 
xmin, ymin, xmax, ymax = aoi.total_bounds
area_km2 = aoi.geometry.area.sum() / 1e6
print(f'AOI: {area_km2:.2f} km² | Bbox UTM: ({xmin:.0f}, {ymin:.0f}) → ({xmax:.0f}, {ymax:.0f})')
 
aoi[['nombre_aoi','geometry']].to_file(OUT_DIR/'aoi_lima_norte_utm18s.gpkg', driver='GPKG')
aoi.to_crs('EPSG:4326')[['nombre_aoi','geometry']].to_file(
    OUT_DIR/'aoi_lima_norte_wgs84.geojson', driver='GeoJSON')
print('AOI exportado en UTM 18S y WGS84')

