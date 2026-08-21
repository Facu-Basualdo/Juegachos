export const VIEW_WIDTH = 480;
export const VIEW_HEIGHT = 720;

export const PADDLE_WIDTH = 80;
export const PADDLE_WIDTH_MIN = 40;
export const PADDLE_SHRINK_PER_HIT = 1.6;
export const PADDLE_HEIGHT = 14;
export const PADDLE_BOTTOM_MARGIN = 30;

export const BALL_RADIUS = 8;

export const PLAYER_SPEED = 560;

export const BALL_SPEED_INITIAL = 470;
export const BALL_SPEED_INCREMENT = 55;
export const BALL_SPEED_MAX = 1150;

export const MAX_DT = 0.032;

/** Ball is integrated in sub-steps no longer than this, so it can't tunnel through the paddle. */
export const MAX_SUBSTEP_DIST = BALL_RADIUS;

export const COUNTDOWN_LABELS = ["3", "2", "1", "YA"];
export const COUNTDOWN_STEP = 0.75;

export const BEST_KEY = "block-paddle:best";
