"""
==================================================================================
INTEGRACIÓN DE CSVs GEE → DATASET FINAL
Script Python — Une todos los CSVs exportados desde GEE en un solo GeoDataFrame
Ejecutar localmente después de descargar los CSVs de Drive
==================================================================================
Estructura esperada de la carpeta Drive 'GEE_LimaNorte_CSV':
  LN_IndicesEspectrales_2017.csv  ... LN_IndicesEspectrales_2024.csv  (8 archivos)
  LN_Topografia.csv                                                    (1 archivo)
  LN_GHSL_epoch2015.csv                                                (1 archivo)
  LN_GHSL_epoch2020.csv                                                (1 archivo)
  LN_DynamicWorld_2017.csv       ... LN_DynamicWorld_2024.csv          (8 archivos)
  LN_NTL_SAR_2017.csv            ... LN_NTL_SAR_2024.csv               (8 archivos)
  ─────────────────────────────────────────────────────────────────────
  Total: 27 archivos CSV → 1 GeoPackage tabular + capas de variables derivadas
==================================================================================
"""

import pandas as pd
import geopandas as gpd
from pathlib import Path

# ── CONFIGURACIÓN ──────────────────────────────────────────────────────────────
CARPETA_CSV  = Path('GEE_LimaNorte_CSV')          # Carpeta donde descargaste los CSVs
RUTA_GRILLA  = Path('datos/grilla_distritos.gpkg') # GeoPackage local de la grilla
RUTA_SALIDA  = Path('datos/dataset_features.gpkg') # Archivo de salida

ANIOS = list(range(2017, 2025))

# ── PASO 1: Cargar geometría de la grilla ─────────────────────────────────────
print("Cargando grilla...")
grilla_geo = gpd.read_file(RUTA_GRILLA)[['cell_id', 'geometry']]
print(f"  {len(grilla_geo):,} celdas cargadas")

# ── PASO 2: Topografía (estática, se repite para todos los años) ─────────────
print("Cargando topografía...")
topo = pd.read_csv(CARPETA_CSV / 'LN_Topografia.csv',
                   usecols=['cell_id', 'ELEV_MEAN', 'SLOPE_MEAN', 'ASPECT_MEAN'])

# ── PASO 3: GHSL (asignar por año usando la época más cercana) ────────────────
print("Cargando GHSL...")
ghsl_2015 = pd.read_csv(CARPETA_CSV / 'LN_GHSL_epoch2015.csv',
                         usecols=['cell_id', 'GHSL_BUILT_MEAN'])
ghsl_2020 = pd.read_csv(CARPETA_CSV / 'LN_GHSL_epoch2020.csv',
                         usecols=['cell_id', 'GHSL_BUILT_MEAN'])
# Renombrar para distinguir al hacer merge
ghsl_2015 = ghsl_2015.rename(columns={'GHSL_BUILT_MEAN': 'GHSL_BUILT_2015'})
ghsl_2020 = ghsl_2020.rename(columns={'GHSL_BUILT_MEAN': 'GHSL_BUILT_2020'})

# ── PASO 4: Construir dataset anual ──────────────────────────────────────────
registros = []

for year in ANIOS:
    print(f"Procesando año {year}...")

    # Índices espectrales
    esp = pd.read_csv(
        CARPETA_CSV / f'LN_IndicesEspectrales_{year}.csv',
        usecols=['cell_id', 'NDVI_MEAN', 'BSI_MEAN', 'MNDWI_MEAN', 'FUENTE_SENSOR']
    )

    # Dynamic World
    dw = pd.read_csv(
        CARPETA_CSV / f'LN_DynamicWorld_{year}.csv',
        usecols=['cell_id', 'DW_BUILT_PROB', 'DW_LABEL_MODE']
    )

    # NTL + SAR
    ntl_sar = pd.read_csv(
        CARPETA_CSV / f'LN_NTL_SAR_{year}.csv',
        usecols=['cell_id', 'NTL_MEAN', 'SAR_VV_MEAN', 'SAR_VH_MEAN', 'SAR_VV_VH_RATIO']
    )

    # Unir todo por cell_id
    df_year = esp.merge(dw,      on='cell_id', how='left') \
                 .merge(ntl_sar, on='cell_id', how='left') \
                 .merge(topo,    on='cell_id', how='left') \
                 .merge(ghsl_2015, on='cell_id', how='left') \
                 .merge(ghsl_2020, on='cell_id', how='left')

    # GHSL por año: usar época más cercana
    # 2017–2018 → 2015 | 2019–2024 → 2020
    if year <= 2018:
        df_year['GHSL_BUILT_MEAN'] = df_year['GHSL_BUILT_2015']
    else:
        df_year['GHSL_BUILT_MEAN'] = df_year['GHSL_BUILT_2020']

    df_year['ANIO'] = year
    registros.append(df_year)

# ── PASO 5: Concatenar todos los años ─────────────────────────────────────────
print("Concatenando años...")
df_total = pd.concat(registros, ignore_index=True)
print(f"  Dataset total: {len(df_total):,} filas × {df_total.shape[1]} columnas")
print(f"  (esperado: {len(grilla_geo):,} celdas × {len(ANIOS)} años = "
      f"{len(grilla_geo) * len(ANIOS):,} filas)")

# ── PASO 6: Columnas finales del modelo ───────────────────────────────────────
COLUMNAS_MODELO = [
    'cell_id', 'ANIO',
    # Espectrales
    'NDVI_MEAN', 'BSI_MEAN', 'MNDWI_MEAN', 'FUENTE_SENSOR',
    # Topografía
    'ELEV_MEAN', 'SLOPE_MEAN', 'ASPECT_MEAN',
    # Huella urbana
    'GHSL_BUILT_MEAN', 'DW_BUILT_PROB', 'DW_LABEL_MODE',
    # Actividad nocturna + SAR
    'NTL_MEAN', 'SAR_VV_MEAN', 'SAR_VH_MEAN', 'SAR_VV_VH_RATIO',
    # GHSL históricas para referencia
    'GHSL_BUILT_2015', 'GHSL_BUILT_2020',
]

df_modelo = df_total[COLUMNAS_MODELO].copy()

# ── PASO 7: Unir geometría y guardar ─────────────────────────────────────────
print("Uniendo geometría y guardando GeoPackage...")
gdf_modelo = grilla_geo.merge(df_modelo, on='cell_id', how='left')

gdf_modelo.to_file(RUTA_SALIDA, layer='features', driver='GPKG')
print(f"  Guardado: {RUTA_SALIDA}")

# También guardar CSV plano (sin geometría) para el modelo
df_modelo.to_csv(RUTA_SALIDA.with_suffix('.csv'), index=False)
print(f"  CSV plano guardado: {RUTA_SALIDA.with_suffix('.csv')}")

# ── DIAGNÓSTICO ───────────────────────────────────────────────────────────────
print("\n── Resumen de valores nulos ──")
nulos = df_modelo.isnull().sum()
nulos_pct = (nulos / len(df_modelo) * 100).round(2)
diag = pd.DataFrame({'nulos': nulos, '%': nulos_pct})
print(diag[diag['nulos'] > 0].to_string())

print("\n── Estadísticas básicas por variable ──")
print(df_modelo[COLUMNAS_MODELO[2:]].describe().round(4).to_string())

print("\nIntegración completada.")
