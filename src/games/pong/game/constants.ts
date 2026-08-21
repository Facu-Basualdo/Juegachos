export const VIEW_WIDTH = 720;
export const VIEW_HEIGHT = 480;

export const PADDLE_WIDTH = 10;
export const PADDLE_HEIGHT = 70;
export const PADDLE_MARGIN = 30;

export const BALL_RADIUS = 7;

export const PLAYER_SPEED = 420;

export const BALL_SPEED_INITIAL = 350;
export const BALL_SPEED_INCREMENT = 18;
export const BALL_SPEED_MAX = 750;
export const BALL_LAUNCH_ANGLE_RANGE = 0.5;

export const AI_SPEED = 310;
export const AI_MARGIN = 30;

export const MAX_DT = 0.032;

/**
 * URL del game server autoritativo (socket.io) para el modo sala. Sin ella (o
 * jugando solo) el juego funciona igual: la landing es 1 jugador y, en sala sin
 * server configurado, cada uno cae a un partido local contra la IA. En sala CON
 * server, el PvP lo arbitra el server (`/pong`). Ver el CLAUDE.md del juego.
 */
// La URL la resuelve `shared/server-status.ts` (principal, con caida al respaldo si
// esta configurado): `Game.ts` usa `isGameServerConfigured()` para decidir el modo y
// `resolveGameServerUrl()` al conectar.
