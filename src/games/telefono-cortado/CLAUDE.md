# Telefono Cortado

Juego de mesa estilo "telefono descompuesto" con dibujos.
Implementado siguiendo el patron de `GameAdapter` para simular turnos localmente, pero pensado para migrar al modo `Salas` donde cada fase este controlada por el servidor o host.

## Mecanicas
1. **Fase de Texto:** El usuario ingresa una frase.
2. **Fase de Dibujo:** El usuario recibe un texto y debe dibujarlo en un canvas nativo.
3. Se encapsulan los pasos en la estructura estandar `GameChain`.

## Notas Tecnicas
- No hay dependencias externas de rendering, solo Canvas 2D nativo.
- Cumple con la cuenta regresiva estandar `3/2/1/YA`.
- Estilos aislados en su propio `style.css`.
