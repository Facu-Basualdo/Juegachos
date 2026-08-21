# Templo Rodante

Esquiva-obstáculos de dos botones en una cámara de piedra vista en **isometría 2D**
(canvas plano, sin Three.js). Por los dos extremos de la sala entran rodando vigas
con púas y hay que leerlas por altura: la **rasante** (piedra al rojo, a ras del
piso) se **salta**; la **alta** (hueso pálido, a la altura del pecho) se esquiva
**agachándose**. Un toque y se terminó. El puntaje son las **vigas esquivadas**
(`direction: "higher"`, formateado `N vigas` en `meta.ts`). La dificultad sube por
escalones con el tiempo.

Referencia de mecánica: el minijuego de las vigas rodantes de *Pummel Party*.

## Estructura

- `main.ts` — punto de entrada, monta `Game` en `#app`.
- `game/constants.ts` — geometría, física, rampa de dificultad y paleta.
  **Tunear acá primero.**
- `game/iso.ts` — la proyección isométrica, en un único lugar (`isoX` / `isoY`).
- `game/Runner.ts` — un corredor: salto parabólico, agachada con mínimo, muerte.
  **Es la misma clase para el jugador y para cada rival de la sala** — de ahí sale
  lo barato que es el canal (ver abajo).
- `game/Beam.ts` — una viga: posición, sentido, tipo (`low` / `high`), giro de las
  púas, y el test de colisión contra un corredor.
- `game/BeamField.ts` — todas las vigas vivas, la agenda y la colisión.
- `game/Renderer.ts` — todo el dibujo. Hornea la sala estática (vacío, muros,
  dintel, losas, foso) una vez en un canvas aparte y cada cuadro dibuja encima las
  llamas, las sombras, las vigas, los corredores y las partículas.
- `game/Particles.ts` — polvo del aterrizaje, chispas de la brasa, estallido de la
  muerte. En coordenadas de **mundo**, se proyectan con la iso al dibujar.
- `game/InputController.ts` — saltar / agacharse por teclado y por toque.
- `game/Hud.ts` — overlay DOM (vigas, récord, inicio / game over, countdown,
  banda de espectador, panel de ranking).
- `game/SoundEffects.ts` — Web Audio sintetizado, sin assets.
- `game/TempleChannel.ts` — solo en sala: canal efímero de **poses**.
- `DESIGN.md` — dirección de arte ("Piedra y Brasa").

## Decisiones no obvias

**Las vigas se agendan por cuándo te CRUZAN, no por cuándo nacen.** `BeamField`
lleva un `nextArrival` (segundo de la partida en que la viga pasa por el corredor)
y recién suelta la viga cuando la distancia de spawn entra en tiempo. Agendar el
nacimiento haría que subir la velocidad acercara las llegadas sin querer, y que el
hueco real entre dos decisiones dependiera de la velocidad de cada viga. Así el
hueco entre dos acciones del jugador es exactamente `gap`, y la velocidad sólo
decide **cuánto tiempo tenés para leer** la que viene.

**Las tres alturas están atadas entre sí y no se tocan de a una.** `JUMP_HEIGHT`
(1.05) tiene que quedar por **debajo** de `BEAM_HIGH_TOP` (1.20): si el salto
pasara por encima de la viga alta, saltar esquivaría las dos y el juego se
convertiría en un solo botón. Y `BEAM_HIGH_BOTTOM` (0.62) tiene que quedar por
**encima** de `DUCK_H` (0.48), que es lo que hace que agacharse sirva. Subir
`SPEED_MAX` sin subir `SPAWN_DIST` recorta el aviso: a la velocidad máxima son
~0.8 s, que es el piso de lo jugable.

**El radio dibujado de la viga sale de su franja de altura**
(`(zMax - zMin) / 2 * Z_SCALE`), no de un número suelto. Un cilindro más fino que
su hitbox mata sin llegar a tocarte.

**La altura se lee por la sombra, no por el color.** La rasante lleva su sombra
pegada al cuerpo; la alta la deja despegada ~50 px abajo. El color (brasa vs.
hueso) y la posición vertical son refuerzos: la sombra es la señal que funciona
incluso de reojo. Es la razón de que `drawShadows` corra antes que las vigas.

**`mix()` devuelve `#rrggbb`, no `rgb(...)`.** Se usa anidado
(`mix(mix(a, b, t), c, u)`) por todos lados y `hex()` sólo parsea `#rrggbb`. Con
salida `rgb(...)` el parseo daba `NaN`, el `fillStyle` quedaba inválido y el canvas
seguía pintando con el color anterior: el piso entero salía casi negro. No
"simplificar" ese formato de vuelta.

**El muro de la izquierda es sólo un dintel.** Existe de `TUNNEL_H` (1.9) para
arriba: por debajo está el vano por el que entran rodando las vigas. Un muro
completo ahí taparía el pasillo. Los extremos de los muros se hunden en negro en
vez de cortarse en seco (la boca del pasillo de un lado, la salida del otro).

**El toque de arranque cuelga del `container`, no del canvas.** La pantalla de
inicio es un overlay que tapa el canvas (ver el `CLAUDE.md` raíz, "El toque de
arranque no puede colgar del canvas"). Como a cambio el handler ve los toques de
toda la pantalla, filtra por estado con `isPlaying`: en menú un toque arranca, y
en partida la mitad de arriba salta y la de abajo agacha.

**No declara `roomTimeLimitSec` y no lo necesita.** Se midió: dejado sin tocar, la
primera viga lo mata a los ~2,2 s, así que un jugador AFK no puede colgar la ronda.
Además la rampa se vuelve durísima al minuto y pico, así que la ronda no se
eterniza tampoco con alguien bueno.

**En teléfono vertical el juego queda en una banda.** La vista es fija (960x620) y
se letterboxea; en portrait el límite es el ancho, así que ocupa ~30 % del alto. No
se puede arreglar con zoom: recortar los costados taparía las bocas por donde
entran las vigas, que es justo lo que hay que ver venir. Mismo trato que el resto
del roster apaisado.

## Modo sala

Todos corren **la misma sala**: un carril por jugador (`laneFor`, por orden de
asiento, así todos los clientes derivan el mismo reparto sin guardar nada) y la
**misma semilla** (`hash(code:round)`), con lo cual las vigas que ves esquivar al
de al lado son exactamente las que te vienen a vos. Al morir se sigue mirando la
sala (`onReportedWaiting`) con la banda de espectador al pie.

**El canal transmite EVENTOS de pose, no posiciones.** `TempleChannel` manda
`jump` / `duck` / `stand` / `dead` y el receptor corre la **misma parábola** del
`Runner` con las mismas constantes. Con eso la animación sale idéntica con dos o
tres mensajes por segundo por jugador (~24/s con la sala llena de 8) en vez de los
10/s por jugador que llevaron a Neon Drift contra el tope de Realtime. Ver
"Canales efímeros de alta frecuencia" en el `CLAUDE.md` raíz.

Dos detalles que lo hacen robusto:

- **El keepalive nunca reenvía `jump`.** Reafirma `stand` / `duck` / `dead` cada
  segundo, para que un mensaje perdido no deje a nadie agachado para siempre en la
  pantalla del resto. Si reenviara `jump` reiniciaría la parábola del rival.
- **Un `stand` no corta un salto en curso.** `Runner.duckEnd()` sólo suelta la
  agachada; la parábola local termina sola. Un salto (0,56 s) siempre cabe dentro
  de la ventana del keepalive (1 s).
- El canal vigila el estado de la suscripción y se reconstruye con backoff, y el
  keepalive va sobre `setInterval` y no sobre el `requestAnimationFrame` (el
  navegador frena el rAF en pestañas de fondo y el jugador desaparecería del resto).
