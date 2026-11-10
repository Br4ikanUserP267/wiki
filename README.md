# Wiki CEJEL IPS · Calidad en Salud

Wiki académica de ocho capítulos sobre calidad, habilitación, PAMEC, acreditación y gestión de servicios de salud para la IPS ficticia **CEJEL IPS S.A.S.**, ubicada en Sincelejo, Sucre.

La aplicación permite consultar, buscar y administrar módulos educativos. El contenido se almacena en MySQL o MariaDB y los capítulos 2–5, 7 y 8 pueden sincronizarse desde documentos Word.

## Requisitos

- Node.js 18 o superior.
- MySQL 8, MariaDB o un servicio compatible.
- Una base de datos creada y una cuenta con permisos sobre ella.

## Configuración e inicio

1. Copia `.env.example` como `.env`.
2. Configura `MYSQL_URL` y cambia las credenciales iniciales.
3. Instala las dependencias con `npm install`.
4. Inicia la aplicación con `npm start` o con doble clic en `Iniciar wiki.bat`.
5. Abre `http://localhost:3000`.

Ejemplo de conexión local:

```dotenv
MYSQL_URL=mysql://usuario:clave@localhost:3306/wiki_cejel
```

Si la contraseña contiene caracteres especiales como `@`, `:`, `/`, `#` o `?`, deben codificarse para una URL. Añade `?ssl=true` cuando el proveedor requiera una conexión cifrada.

## Usuarios y roles

Los usuarios iniciales se definen en `.env` y se crean durante el arranque:

```dotenv
USUARIO_1=admin:CAMBIA_ESTA_CLAVE:admin
USUARIO_2=editor:CAMBIA_ESTA_CLAVE_2:editor
```

- `admin`: crea, edita, ordena y elimina contenido; también gestiona usuarios, importaciones y copias.
- `editor`: crea, edita y ordena contenido, pero no puede eliminarlo ni entrar a Administración.
- La lectura y la búsqueda no requieren iniciar sesión.

Cada usuario puede cambiar su contraseña desde la aplicación. La contraseña debe tener al menos 10 caracteres. No publiques `.env` ni uses las credenciales de ejemplo en un entorno real.

## Documentos fuente

Los documentos académicos están organizados en [`docs`](docs/README.md):

- Capítulo 2: diagnóstico institucional.
- Capítulo 3: Sistema Único de Habilitación.
- Capítulo 4: PAMEC.
- Capítulo 5: Sistema Único de Acreditación.
- Capítulo 7: gestión administrativa y financiera de los servicios de salud.
- Capítulo 8: plan de fortalecimiento institucional.
- Créditos: autores y códigos estudiantiles en `docs/CREADORES.TXT`.

Después de modificar los archivos Word, sincroniza la semilla con:

```powershell
npm.cmd run sync:docs
```

Este proceso conserva los módulos 1 y 6 y reemplaza los módulos 2–5, 7 y 8 de `server/seed.json`. Convierte párrafos, encabezados, listas y tablas a Markdown.

La semilla se carga solo cuando la tabla de módulos está vacía. Una base de datos que ya contiene módulos no se modifica automáticamente.

## Creación de contenido con IA

La integración opcional con DeepSeek permite crear módulos desde Word o desde una instrucción:

1. Crea una llave en DeepSeek Platform.
2. Configura `DEEPSEEK_API_KEY` en `.env` y reinicia la aplicación.
3. Inicia sesión como administrador o editor.
4. Usa **Importar Word**, **Crear con IA** o **Completar con IA** y revisa el borrador antes de guardarlo.

El archivo `.docx` se procesa localmente con Mammoth y el texto extraído se envía a DeepSeek. El formato antiguo `.doc` no está soportado.

## Funciones principales

- **Buscar:** recorre todos los módulos, ignora tildes y mayúsculas y permite usar `/` como atajo. `Esc` limpia la búsqueda.
- **Editar:** permite crear y modificar módulos y secciones después de iniciar sesión.
- **Ordenar:** cada módulo y sección dispone de controles para subir o bajar su posición.
- **Administrar:** los administradores pueden gestionar usuarios, exportar e importar contenido y crear copias.
- **Enlaces directos:** `#m3` abre el módulo 3, `#m3/s12` una sección y `?q=glosas` una búsqueda.
- **Accesibilidad:** incluye tamaño de texto y alto contraste.
- **Multimedia:** admite imágenes por URL y videos de YouTube, Vimeo o archivos directos compatibles.

## Formato del contenido

| Escritura | Resultado |
|---|---|
| `### Subtítulo` | Subtítulo |
| `- texto` | Lista con viñetas |
| `1. texto` | Lista numerada |
| `**negrita**` y `*cursiva*` | Énfasis |
| `> texto` | Recuadro destacado |
| `\| A \| B \|` y una fila `\|---\|---\|` | Tabla |
| `[texto](https://ejemplo.com)` | Enlace externo |
| `[texto](#m3/s12)` | Enlace interno |
| `![descripción](https://ejemplo.com/imagen.jpg)` | Imagen con descripción |

## Base de datos y contenido

Las tablas se crean automáticamente al iniciar la aplicación. `MYSQL_URL` es obligatorio.

- **Exportar contenido:** Administración → Exportar contenido genera un JSON con módulos y secciones.
- **Importar contenido:** Administración → Importar contenido reemplaza los módulos y secciones después de crear una copia interna.
- **Contenido inicial:** `server/seed.json` se utiliza únicamente cuando no existen módulos.
- **Documentos fuente:** `npm.cmd run sync:docs` actualiza en la semilla los capítulos desarrollados en Word.

## Estructura

```text
Iniciar wiki.bat      Lanzador para Windows
.env                  Configuración privada local
.env.example          Plantilla de configuración
package.json          Dependencias y comandos npm
server/server.js      Servidor, API, autenticación y acceso a MySQL
server/seed.json      Contenido inicial de la wiki
scripts/sync-docs.js  Conversor de Word a la semilla JSON
docs/                 Documentos Word fuente y guía de edición
public/index.html     Interfaz web
public/images/        Logo e imágenes de módulos
assets/               Recursos originales
```

## Seguridad

La aplicación usa contraseñas derivadas con scrypt, cookies de sesión `HttpOnly` y `SameSite=Strict`, bloqueo temporal tras intentos fallidos y escape del contenido antes de mostrarlo. Los enlaces se limitan a protocolos seguros o rutas internas.

Para publicarla en internet, utiliza HTTPS, activa la marca `Secure` de la cookie, restringe el acceso a MySQL y reemplaza todas las credenciales de ejemplo.
