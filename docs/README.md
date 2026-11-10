# Documentos fuente

Esta carpeta contiene los documentos académicos que alimentan los capítulos desarrollados de la wiki.

| Archivo | Contenido | Destino en la wiki |
|---|---|---|
| `capitulo-02-diagnostico-institucional.docx` | Caracterización y diagnóstico de CEJEL IPS | Módulo 2 |
| `capitulo-03-sistema-unico-habilitacion.docx` | Sistema Único de Habilitación | Módulo 3 |
| `capitulo-04-pamec.docx` | PAMEC y mejoramiento continuo | Módulo 4 |
| `capitulo-05-sistema-unico-acreditacion.docx` | Sistema Único de Acreditación | Módulo 5 |

## Sincronizar los documentos

Después de modificar un archivo Word, ejecuta desde la raíz del proyecto:

```powershell
npm.cmd run sync:docs
```

El comando extrae títulos, párrafos, listas y tablas, y actualiza los módulos 2 a 5 de `server/seed.json`. Los demás módulos no se modifican.

`server/seed.json` se usa únicamente cuando la base de datos está vacía. Si la wiki ya tiene contenido en MySQL, importa el contenido actualizado desde la administración o inicia una base de datos vacía.

## Convención de edición

- Conserva los encabezados principales con el formato `2.1. Título`, `3.1. Título`, etc.
- Usa estilos de título de Word o texto en negrita para los encabezados principales.
- Mantén tablas y listas como elementos nativos de Word para que se conviertan correctamente.
- No cambies los nombres de archivo sin actualizar `scripts/sync-docs.js`.
