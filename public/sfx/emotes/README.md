# Sonidos de las reacciones

Samples de las cinco reacciones de **Bomba Palabra** y **Cadena de Palabras** (los dos
juegos comparten el set de emotes y cada uno tiene su copia de `EmoteAudio.ts`, por la
regla de decoupling del repo).

Es una de las dos **excepciones** del repo a la regla de sintetizar todo con Web Audio
(ver el `CLAUDE.md` de sliding-puzzle): una risa humana no la hace un oscilador. La otra
es el grito de BASTA, en `../basta/`.

## Archivos esperados

Exactamente estos cinco nombres, en esta carpeta:

| Archivo        | Reaccion  | Tecla |
| -------------- | --------- | ----- |
| `risa.mp3`     | Risa      | 1     |
| `sorpresa.mp3` | Sorpresa  | 2     |
| `enojo.mp3`    | Enojo     | 3     |
| `burla.mp3`    | Burla     | 4     |
| `llanto.mp3`   | Llanto    | 5     |

## Criterio

**Las reacciones se superponen y se saturan a proposito.** Duran mas que el cooldown de
1s del server (`EMOTE_COOLDOWN_MS`) y mas que la cara (`EMOTE_MS`, 1.8s), asi que con la
mesa llena se apilan varias risas encima de un llanto. Eso es **deliberado**: es lo que
hace graciosa la mesa, no un bug a corregir. `EmoteAudio.play()` crea un `BufferSource`
nuevo por reaccion, que es justo lo que permite el apilado; **no** hay que "arreglarlo"
cortando el sample anterior.

Lo que sigue vigente:

- **Licencia libre para uso comercial**. CC0 / dominio publico:
  freesound.org filtrando por CC0, Pixabay o Mixkit.
- **Ojo con el peso**: los cinco se bajan al entrar al juego (hoy ~435 KB en total,
  todos estereo). Pasar a mono los dejaria a la mitad sin diferencia audible en un
  efecto corto.
- **Volumen parejo entre si.** El `SAMPLE_GAIN` es uno solo para los cinco, asi que un
  sample con mucho mas cuerpo que el resto se lleva la mesa puesta. Hoy la risa y la
  sorpresa suenan ~2.7x mas fuerte (en RMS) que el enojo o el llanto.

## Los que hay hoy

| Archivo | Duracion | Peso | Nota |
| ------- | -------- | ---- | ---- |
| `risa.mp3` | 3.38s | 132 KB | risa aguda tipo rana; el pico llega a 1.0 (saturado, buscado) |
| `sorpresa.mp3` | 1.25s | 21 KB | arranca con 0.09s de silencio |
| `enojo.mp3` | 5.08s | 80 KB | el mas largo |
| `burla.mp3` | 2.65s | 43 KB | arranca con 0.32s de silencio: tarda en entrar respecto del salto |
| `llanto.mp3` | 4.08s | 159 KB | el mas pesado |

## Como suenan hoy

Faltando el mp3, cada reaccion suena con su version **sintetizada** (`SoundEffects.playEmote`).
No hay que borrar nada: `EmoteAudio.play()` devuelve `false` y el sintetizado toma el
lugar. Agregar un solo archivo (por ejemplo `risa.mp3`) ya lo hace sonar a el y deja las
otras cuatro sintetizadas.

## Ajustar el volumen

`SAMPLE_GAIN` esta duplicado en los dos juegos:

- `src/games/word-bomb/game/EmoteAudio.ts`
- `src/games/word-chain/game/EmoteAudio.ts`
