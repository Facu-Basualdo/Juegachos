# Laser Show (`laser-show`)

Un escenario redondo de programa de TV (Three.js, camara fija que muestra el escenario
entero, como Pista Loca) con una torre de lasers en el centro. Los lasers lo barren cada
vez mas rapido: los **rojos** pasan rasantes y se saltan, los **celestes** pasan altos y
se esquivan agachado, y la **lluvia de rayos** marca circulos en el piso que despues
estallan. Si te toca un laser (o te caes del escenario) quedas afuera. Se empuja. Gana
el ultimo en pie. **Solo se juega en salas** y **necesita el game server**.

Es Pista Loca (mismo reparto cliente/server, misma camara, mismos controles y el mismo
empujon) con los lasers de La Cuerda (funciones del tiempo con choque barrido). Si algo
no esta documentado aca, mirar los `CLAUDE.md` de `pista-loca` y `la-cuerda`.

Estetica: ver [DESIGN.md](DESIGN.md) ("Prime Time"): el estudio de un programa de
concursos. Todo por codigo.

## Metodo de simulacion (aprobado por el programador)

Arquetipo "Saltos Reactivos" de [SIMULATION_ARCHITECTURE.md](../../../SIMULATION_ARCHITECTURE.md):
cinematica analitica, nada de simular los lasers como cuerpos.

- **Cada laser es una funcion cerrada del tiempo** (ms desde la largada), generada de una
  vez con la semilla que manda el server (`buildShow` en `game/Lasers.ts`, PRNG
  mulberry32). Ninguna posicion de laser viaja por la red y **el server ni siquiera los
  genera**: solo manda `seed` y `elapsed`. Misma semilla + mismo reloj = mismo show en
  todas las pantallas.
- **Jugador**: Euler semi-implicito a paso fijo de 120 Hz (`Player.ts`, la fisica de Pista
  Loca con el piso de disco). La torre del centro es un cilindro solido.
- **Choque barrido** (`hitsPlayer`): entre el reloj del cuadro anterior y el actual, no
  solo el final (la punta de una barrida va a ~20 m/s). Para barridas y paredes el barrido
  es **analitico**, no por muestras: la barrida ocupa el arco `[inicio - hw, fin + hw]`
  visto desde el centro (con `hw = asin(alcance / distancia)`), la pared el intervalo de
  su desplazamiento. Verificado contra fuerza bruta (pasos de 0.05 ms, ~10.000 casos al
  azar): cero diferencias.
- **El barrido se acota a `MAX_DT` para atras** (`Game.updatePlayer`). Sin eso, al volver
  de un F5 a mitad del show el primer cuadro barreria desde 0 y te mataria por lasers que
  ya pasaron.

## Los lasers (`Lasers.ts`)

| Familia | Que es | Como se esquiva |
| --- | --- | --- |
| `spin` (barrida) | 1-4 brazos que salen de la torre y giran; aparecen primero como fantasma (`warn`, no mata) | saltar (rojo) / agacharse (celeste) |
| `wall` (pared) | una linea que cruza el escenario de punta a punta entre dos drones; espera `WALL_WARN` afuera antes de arrancar | saltar / agacharse |
| `zone` (lluvia) | un circulo que avisa en el piso y despues estalla en columna (`ZONE_BLAST`) | salir del circulo (no importa la altura) |

Alturas: rasante `LOW_Y` 0.42 m, alto `HIGH_Y` 1.3 m. Cuerpo parado 1.7 m, agachado 0.9 m;
el salto (~1.3 m) deja los pies sobre el rasante ~0.47 s, y saltando **no** se esquiva el alto.

**El show** arranca con una presentacion fija (pared rasante, pared alta, lluvia: una de
cada cosa, cada una anunciada) y despues encadena pruebas al azar (`sweep`, `wall`,
`double`, `cross`, `zones`) que se aceleran y se superponen con `difficulty(t)` (tope a los
100 s). Reglas que lo mantienen jugable: nunca dos barridas a la vez, entre dos brazos
seguidos pasan >= 0.6 s, y en la pared doble la segunda viene a >= 3.4 m de la primera.
Cada prueba tiene un titulo que el locutor anuncia en un zocalo (`waves`).

**Sale sola:** medido, un jugador quieto cae a los 4-6 s (la primera pared rasante lo
cruza en cualquier lugar del escenario).

## Arquitectura

- **Server** (`server/src/games/lasershow.ts`, namespace `/lasershow`, prefijo `ls:`):
  semilla, reloj, orden de eliminacion, relay de posiciones a 20 Hz y el empujon. Saca al
  desconectado a los 10 s.
- **Cliente** (`game/Game.ts`): genera el show, dibuja los lasers (`LaserView.ts`, que arma
  cada vista un poco antes de que aparezca y la tira al terminar), simula su muñeco y
  **declara su propio toque** (`ls:dead`): ve el laser con la misma latencia con la que
  recibe el reloj, asi que juzgarlo en el server castigaria al de peor conexion.
  Spoofeable, como en el resto de los juegos de sala.

**El reloj** (`clockBase`): hora local del ms 0 de la partida, estimada con el **minimo**
de `(llegada - elapsed)` visto (la muestra que menos latencia comio). Solo avanza, asi los
lasers no saltan para atras cuando llega un estado demorado. El server manda `elapsed`
negativo durante la cuenta regresiva, y con eso se arma el 3 / 2 / 1 / YA.

**Puntaje:** segundos aguantados (`higher`, formato `N.N s`). Fin: queda uno en pie (con 2+
largando) y juega una **vuelta de honor** de `LAP_MS` (5 s) antes de que se corte, asi el
ultimo siempre suma mas que el segundo; se caen todos; o se llega al tope de 150 s.
`roomTimeLimitSec: 180` es la red por si el server se cae despues de largar.

## Controles

WASD / flechas, ESPACIO salta, SHIFT o C (mantener) agacha, F o clic empuja. **CTRL no
agacha a proposito**: CTRL+W (adelante) cierra la pestaña. En el celu: joystick flotante en
cualquier lado y los botones EMPUJAR, AGACHARSE (mantener; el Hud usa `setPointerCapture` y
suelta en `pointerup` / `pointercancel` / `lostpointercapture`) y SALTAR, solo con
`pointer: coarse`. Agacharse solo vale en el piso, frena a `DUCK_SPEED` y no deja saltar.

## Gotchas

- **El codigo de sala del devRoom tiene que tener 4+ caracteres** (`sanitizeCode` del
  server descarta el join si no): con `code=T1` el cliente conecta y nunca recibe el
  `ls:init`.
- **El rojo es rojo anaranjado (`#ff4a1c`), no rojo frio**: con el brillo aditivo sobre el
  escenario azul, un rojo frio (`#ff3b5c`) se leia rosa y se confundia con el magenta de
  la lluvia.
- **Las columnas de la lluvia son bajas (`ZONE_TOP` 4.5 m) y tenues**: a 12 m tapaban media
  pantalla desde la camara alta y lavaban todo.
- **Al terminar se limpian los lasers** (`laserView.clear()` en `finish`): el reloj queda
  congelado y si no quedaban colgados detras del cartel de resultados.
- **Los botones del celu no usan `font: inherit`** sino `font-family: inherit`: el
  shorthand en `.ls-controls button` le ganaba en especificidad al tamaño de cada boton y
  las etiquetas se cortaban ("EMPUJ").

## Probar sin Supabase (`devRoom.ts`)

`/games/laser-show/?dev=Ana&roster=Ana,Beto&code=TEST` en **dev**, una pestaña por
nickname con el mismo `code` y `roster`, contra un game server local
(`VITE_GAME_SERVER_URL=http://localhost:8787`). El puntaje va a la consola y a
`window.__laserShowScore`. En el build queda eliminado.

## Movil

`mobile: true`, verificado **en emulacion** (Playwright, iPhone 13, touch real por CDP), no
en un telefono real: AGACHARSE se mantiene y se suelta bien y el joystick mueve.
