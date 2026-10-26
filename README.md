# 3D World — sitio de impresión 3D

Página estática (HTML/CSS/JS, sin build) con:

- **Portada** con un modelo 3D que se "imprime" capa por capa.
- **Catálogo** de modelos 3D interactivos (girar, cambiar color, ver malla, zoom). El botón **Me interesa** abre WhatsApp con el mensaje listo.
- **Imprime tu modelo**: el cliente sube su STL/3MF/OBJ/GLB (si es multicolor, se ve con sus colores), lo ve sobre la cama de impresión, ajusta la escala y envía el pedido por WhatsApp. El archivo se procesa en su navegador y no se sube a ningún servidor.
- **Panel secreto** para que el dueño añada, edite y elimine modelos, colores, precios y datos de contacto desde la misma página.
- Modo oscuro (negro/rojo/gris) y modo claro.
- **Vista de figuras** (`/figuras/`): galería de fotos de figuras pintadas a mano, con estilo neón propio. No está enlazada desde la página principal: se entra escribiendo la URL.

## Estructura

```
index.html          Estructura de la página
css/styles.css      Estilos (colores en las variables de :root)
js/main.js          Lógica de la página
js/scenes.js        Visores 3D (Three.js)
js/models.js        Modelos de demostración generados por código
js/model3mf.js      Lector de 3MF (piezas, colores y filamentos de Bambu/Orca/PrusaSlicer)
js/admin.js         Panel de administración: acceso, sesión y publicación (solo se carga al activarlo)
js/admin-catalog.js Editores del catálogo 3D (página principal)
js/admin-figuras.js Editores de la galería de figuras (solo fotos)
js/admin-photos.js  Subida y optimización de fotos (figuras y fotos del resultado)
figuras/index.html  Vista de figuras pintadas
css/figuras.css     Tema neón de la vista de figuras
js/figuras.js       Lógica de la vista de figuras
data/figuras.json   Contenido de la galería de figuras
images/figuras/     Fotos de figuras subidas desde el panel
images/modelos/     Fotos del resultado de los modelos 3D
js/github.js        Publicación de cambios vía API de GitHub
data/site.json      TODO el contenido editable (catálogo, colores, contacto…)
data/admin.json     Se crea al configurar el panel (token cifrado)
models/             Archivos 3D subidos desde el panel
```

## Probar en tu computadora

Los navegadores bloquean `fetch` y los módulos al abrir el archivo con doble clic, así que hace falta un servidor local:

```bash
npx serve .
# o
python -m http.server 5173
```

En VS Code también puedes usar la extensión **Live Server** (clic derecho en `index.html` → *Open with Live Server*).

## Publicar en GitHub Pages (gratis)

1. Crea un repositorio en GitHub y sube todos estos archivos a la rama `main`.
2. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. En 1–2 minutos el sitio queda en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

## Configurar el panel de administración (una sola vez)

### 1. Crear el token de GitHub

1. GitHub → foto de perfil → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access**: *Only select repositories* → elige **solo** el repositorio del sitio.
3. **Permissions → Repository permissions → Contents: Read and write** (no hace falta nada más).
4. **Expiration**: lo que prefieras (máx. 1 año). Cuando venza, crea otro y repite el paso 2.
5. Copia el token (empieza con `github_pat_`).

### 2. Configurar la contraseña en el sitio

1. Abre el sitio publicado y entra a `…/#admin` (o toca **5 veces seguidas el logo del pie de página**).
2. Completa usuario, repositorio, token y una contraseña de **al menos 12 caracteres**.
3. Listo: se crea `data/admin.json` con el token **cifrado**. Desde ahora, en cualquier dispositivo, basta con el acceso secreto y la contraseña.

> Si olvidas la contraseña o venció el token: abre el acceso secreto y usa *"¿Olvidaste la contraseña o cambiaste el token?"*. Necesitarás un token válido.

### Uso del panel

- Barra inferior: **+ Modelo**, **Colores**, **Datos** (nombre, WhatsApp, Instagram, email, ubicación, horario, moneda), **Publicar** y **Salir**.
- Cada tarjeta muestra **Editar** y **Eliminar**.
- Al subir un archivo 3D (STL, 3MF, OBJ o GLB), las medidas se calculan solas (en mm).
- **Fotos del resultado** (opcional, hasta 6 por modelo): fotos reales de la pieza ya impresa. Se optimizan solas (WebP) y se guardan en `images/modelos/`. Si un modelo tiene fotos, **la foto es su imagen principal**: la tarjeta muestra la foto (la segunda al pasar el mouse) y la ficha abre en *Foto real*; el 3D queda como opción (botón *Ver en 3D* o pestaña *Modelo 3D*) y su archivo solo se descarga cuando alguien lo pide. Los modelos sin fotos se ven en 3D como siempre.
- **Colores del modelo**: cada modelo tiene uno de tres modos.
  - *Un color*: el cliente elige un color de filamento.
  - *Multicolor*: el panel detecta las piezas del archivo; puedes renombrarlas y darles un color inicial. El cliente elige el color de cada pieza y el mensaje de WhatsApp las lista.
  - *Colores del diseño*: se muestra con los colores que trae el archivo, fijos.
- Qué trae cada formato: **3MF** de Bambu Studio, Orca o PrusaSlicer trae el filamento de cada pieza y la pintura multicolor (los triángulos pintados con detalle muy fino se aproximan al color predominante). **GLB** trae colores y texturas. **STL** y **OBJ** no traen colores (el OBJ sí separa piezas por material). Las texturas solo se ven en *Colores del diseño*.
- Los cambios se ven al instante en tu pantalla, pero **solo se guardan al pulsar Publicar**. Eso crea un commit en el repo, y GitHub Pages actualiza el sitio para todos en 1–2 minutos.
- Si cierras la pestaña, la sesión se cierra sola.

## Vista de figuras (/figuras/)

Galería de figuras impresas y pintadas a mano. Aquí se publican **fotos**, no modelos 3D.

- Dirección: `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/figuras/`. No hay enlaces hacia ella desde la página principal.
- El panel se abre igual (`/figuras/#admin` o 5 toques al logo del pie) y usa la misma contraseña.
- Barra del panel: **+ Figura**, **Textos** (título y presentación de la portada), **Publicar** y **Salir**.
- Cada figura tiene nombre, serie (sirve de filtro), descripción, altura, precio, estado (*Disponible*, *Por encargo* o *Vendida*) y hasta 12 fotos. La primera es la portada; se reordenan con las flechas.
- Las fotos se reducen y convierten a WebP en el navegador antes de publicarse (una de 1600 px y una miniatura de 640 px), así la galería carga rápido aunque subas fotos del celular.
- WhatsApp, Instagram y demás datos de contacto se toman de `data/site.json`: se editan una sola vez desde la página principal (botón **Datos**).
- Las tres figuras que vienen de ejemplo usan imágenes de muestra: bórralas cuando subas las tuyas.

## Seguridad

- **El contenido del catálogo es público** a propósito (nombres, precios, colores, WhatsApp): no se cifra porque los visitantes tienen que poder verlo.
- **El token** se guarda cifrado con AES-256-GCM, con una clave derivada de tu contraseña (PBKDF2-SHA256, 600 000 iteraciones). El archivo cifrado es público en el repo, así que usa una contraseña larga y única. Además, el token solo tiene acceso a este repositorio.
- Mientras el panel está abierto, el token descifrado vive solo en esa pestaña (`sessionStorage`).
- Todo el texto que escribe el dueño se muestra como texto, nunca como HTML.
- `index.html` incluye una **Content-Security-Policy** que solo permite scripts propios y Three.js desde jsdelivr. Si modificas alguno de los dos `<script>` en línea de `index.html` (el del tema o el `importmap`), recalcula sus hashes:

  ```bash
  node -e "const h=require('fs').readFileSync('index.html','utf8');for(const m of h.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g))console.log('sha256-'+require('crypto').createHash('sha256').update(m[1]).digest('base64'))"
  ```

- Los archivos que suben los clientes en "Imprime tu modelo" nunca salen de su navegador.

## Editar a mano (sin panel)

Todo está en `data/site.json`:

| Campo | Qué es |
|---|---|
| `brand`, `tagline` | Nombre y frase del negocio |
| `contact.whatsapp` | Número con código de país, solo dígitos (ej. `5215512345678`) |
| `printer` | Volumen de impresión en mm y altura de capa |
| `pricing.perGram` | Si pones un número, "Imprime tu modelo" muestra un precio estimado |
| `colors`, `materials` | Colores de filamento y materiales |
| `items` | Catálogo. `model` puede ser `models/archivo.stl` (o .3mf/.obj/.glb) o un modelo demo `procedural:…` |

En `items`, `price: null` muestra "Cotizar". `colorMode` puede ser `"parts"` (con `parts: [{ "name": "Cuerpo", "color": "blanco" }, …]`, una entrada por pieza en el orden del archivo) u `"original"`; si falta, es de un color. Si `colors` o `materials` quedan vacíos (`[]`), el modelo usa todos los disponibles.
