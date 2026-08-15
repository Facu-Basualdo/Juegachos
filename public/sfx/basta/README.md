# Sonido de BASTA

Sample del grito que suena en **todas** las pantallas cuando alguien completa las 7
categorias y corta la ronda (el server pasa a la fase `grace`).

Es una de las pocas excepciones del repo a la regla de sintetizar todo con Web Audio
(la otra son las reacciones de Bomba Palabra, en `../emotes/`): el corte es el golpe de
efecto del juego y un oscilador no lo da.

## Archivo esperado

| Archivo     | Cuando suena                                  |
| ----------- | --------------------------------------------- |
| `basta.mp3` | Alguien grita BASTA (fase `grace` del server). |

## Criterio

- **Corto y seco.** Se solapa con el cartel de "X grito BASTA. Cerrando..." y con los 5s
  de gracia; si dura mas que eso, pisa la transicion a la votacion.
- Se reproduce con un gain de `SAMPLE_GAIN` (0.5) en `src/games/basta/game/BastaAudio.ts`,
  porque los samples vienen mucho mas fuertes que los osciladores del juego (pico <= 0.12).
- Suena **una sola vez por letra**: lo dispara el cambio de fase, no el click, asi que no
  se apila (a diferencia de las reacciones de Bomba Palabra, que se apilan a proposito).

## Si falta

No pasa nada: `BastaAudio.play()` devuelve `false` y `SoundEffects.playBasta()` cae al
campanazo sintetizado. Ojo que en `npm run dev` un archivo faltante **no da 404** (Vite
responde 200 con el index.html); lo que falla es el decode, y el mismo `catch` lo cubre.
