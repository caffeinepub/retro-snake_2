import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActor } from "./hooks/useActor";

// ---- Types ----
type Point = { x: number; y: number };
type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";
type Theme = "forest" | "neon";
type ItemType = "apple" | "speed" | "bomb";
type GameState = "start" | "playing" | "paused" | "gameover";
type Difficulty = "easy" | "medium" | "hard";

interface Item {
  pos: Point;
  type: ItemType;
  spawnTime: number;
}

interface GameData {
  snake: Point[];
  dir: Direction;
  nextDir: Direction;
  items: Item[];
  score: number;
  lives: number;
  gameState: GameState;
  speedBoostEnd: number;
  eatEffect: { pos: Point; end: number } | null;
  appleCount: number;
  bombSpawnCounter: number;
}

interface DifficultyConfig {
  base: number;
  boost: number;
}

// ---- Constants ----
const GRID = 20;
const CELL = 28;
const CANVAS_SIZE = GRID * CELL;
const SPEED_BOOST_MS = 5000;
const SPEED_ITEM_LIFETIME = 8000;
const BOMB_SPAWN_EVERY = 8;
const EAT_EFFECT_MS = 400;

const DIFFICULTY_CONFIG: Record<Difficulty, DifficultyConfig> = {
  easy: { base: 220, boost: 100 },
  medium: { base: 150, boost: 80 },
  hard: { base: 90, boost: 50 },
};

// ---- Web Audio SFX ----
function createAudioCtx(): AudioContext | null {
  try {
    return new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    )();
  } catch {
    return null;
  }
}

function playTone(
  ctx: AudioContext,
  freq: number,
  type: OscillatorType,
  duration: number,
  gain = 0.18,
  freqEnd?: number,
) {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (freqEnd !== undefined) {
    osc.frequency.linearRampToValueAtTime(freqEnd, ctx.currentTime + duration);
  }
  gainNode.gain.setValueAtTime(gain, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

function sfxEat(ctx: AudioContext) {
  playTone(ctx, 440, "square", 0.08, 0.15, 660);
}

function sfxSpeed(ctx: AudioContext) {
  playTone(ctx, 300, "sawtooth", 0.05, 0.12, 900);
  setTimeout(() => playTone(ctx, 600, "square", 0.08, 0.12, 1200), 60);
}

function sfxBomb(ctx: AudioContext) {
  playTone(ctx, 180, "sawtooth", 0.3, 0.22, 50);
}

function sfxGameOver(ctx: AudioContext) {
  const notes = [440, 370, 294, 220];
  notes.forEach((n, i) => {
    setTimeout(() => playTone(ctx, n, "square", 0.2, 0.18), i * 150);
  });
}

function sfxPause(ctx: AudioContext) {
  playTone(ctx, 520, "square", 0.1, 0.1);
}

function sfxStart(ctx: AudioContext) {
  [262, 330, 392, 523].forEach((n, i) => {
    setTimeout(() => playTone(ctx, n, "square", 0.12, 0.15), i * 80);
  });
}

// ---- Helpers ----
function randomCell(exclude: Point[]): Point {
  let pos: Point;
  do {
    pos = {
      x: Math.floor(Math.random() * GRID),
      y: Math.floor(Math.random() * GRID),
    };
  } while (exclude.some((p) => p.x === pos.x && p.y === pos.y));
  return pos;
}

function initGame(): GameData {
  const snake: Point[] = [
    { x: 12, y: 10 },
    { x: 11, y: 10 },
    { x: 10, y: 10 },
  ];
  const apple: Item = {
    pos: randomCell(snake),
    type: "apple",
    spawnTime: Date.now(),
  };
  return {
    snake,
    dir: "RIGHT",
    nextDir: "RIGHT",
    items: [apple],
    score: 0,
    lives: 3,
    gameState: "playing",
    speedBoostEnd: 0,
    eatEffect: null,
    appleCount: 0,
    bombSpawnCounter: 0,
  };
}

function dirAngle(dir: Direction): number {
  if (dir === "RIGHT") return 0;
  if (dir === "DOWN") return Math.PI / 2;
  if (dir === "LEFT") return Math.PI;
  return (3 * Math.PI) / 2;
}

function vecToDir(dx: number, dy: number): Direction {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "RIGHT" : "LEFT";
  return dy > 0 ? "DOWN" : "UP";
}

// ---- Pixel-art canvas drawing ----

function drawBoard(ctx: CanvasRenderingContext2D, theme: Theme) {
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (theme === "forest") {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#1a3a20" : "#1e4225";
      } else {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#080d14" : "#0a1019";
      }
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
  if (theme === "neon") {
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = "rgba(0,255,200,0.07)";
    for (let i = 0; i <= GRID; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL, 0);
      ctx.lineTo(i * CELL, CANVAS_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * CELL);
      ctx.lineTo(CANVAS_SIZE, i * CELL);
      ctx.stroke();
    }
  }
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke?: string,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawSnakeHead(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dir: Direction,
  theme: Theme,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(dirAngle(dir));

  const r = CELL / 2 - 2;
  const headColor = theme === "neon" ? "#00ff88" : "#44dd44";
  const highlightColor = theme === "neon" ? "#aaffdd" : "#88ff88";
  const eyeColor = "#001a08";

  // Body
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = headColor;
  ctx.fill();
  ctx.strokeStyle = theme === "neon" ? "#00ffcc" : "#22aa22";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Highlight
  ctx.beginPath();
  ctx.arc(-r * 0.15, -r * 0.25, r * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = highlightColor;
  ctx.globalAlpha = 0.35;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Eyes (facing right by default)
  const eyeOffX = r * 0.3;
  const eyeOffY = r * 0.38;
  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.arc(eyeOffX, -eyeOffY, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(eyeOffX, eyeOffY, 2.5, 0, Math.PI * 2);
  ctx.fill();
  // Eye shine
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(eyeOffX + 1, -eyeOffY - 1, 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(eyeOffX + 1, eyeOffY - 1, 0.9, 0, Math.PI * 2);
  ctx.fill();

  // Tongue
  ctx.strokeStyle = "#ff3366";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(r + 5, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(r + 5, 0);
  ctx.lineTo(r + 8, -2.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(r + 5, 0);
  ctx.lineTo(r + 8, 2.5);
  ctx.stroke();

  ctx.restore();
}

function drawSnakeBody(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  isVertical: boolean,
  theme: Theme,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;

  const bodyColor = theme === "neon" ? "#00cc66" : "#2ab52a";
  const borderColor = theme === "neon" ? "#00ffaa" : "#1a8a1a";
  const scaleColor =
    theme === "neon" ? "rgba(0,255,180,0.18)" : "rgba(100,255,100,0.18)";

  const w = isVertical ? CELL - 6 : CELL - 4;
  const h = isVertical ? CELL - 4 : CELL - 6;
  drawRoundRect(ctx, cx - w / 2, cy - h / 2, w, h, 4, bodyColor, borderColor);

  // Scale detail
  ctx.fillStyle = scaleColor;
  if (isVertical) {
    ctx.fillRect(cx - 2, cy - 3, 4, 6);
  } else {
    ctx.fillRect(cx - 3, cy - 2, 6, 4);
  }

  ctx.restore();
}

function drawSnakeTail(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dir: Direction,
  theme: Theme,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(dirAngle(dir));

  const tailColor = theme === "neon" ? "#008844" : "#1a8a1a";
  ctx.beginPath();
  ctx.moveTo(-CELL / 2 + 4, -CELL / 2 + 6);
  ctx.lineTo(CELL / 2 - 6, 0);
  ctx.lineTo(-CELL / 2 + 4, CELL / 2 - 6);
  ctx.closePath();
  ctx.fillStyle = tailColor;
  ctx.fill();
  ctx.strokeStyle = theme === "neon" ? "#00ffaa" : "#115511";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

function drawSnake(
  ctx: CanvasRenderingContext2D,
  snake: Point[],
  theme: Theme,
  dir: Direction,
) {
  for (let i = snake.length - 1; i >= 0; i--) {
    const seg = snake[i];
    const cx = seg.x * CELL + CELL / 2;
    const cy = seg.y * CELL + CELL / 2;

    if (i === 0) {
      drawSnakeHead(ctx, cx, cy, dir, theme);
    } else if (i === snake.length - 1) {
      const prev = snake[i - 1];
      const tailDir = vecToDir(prev.x - seg.x, prev.y - seg.y);
      drawSnakeTail(ctx, cx, cy, tailDir, theme);
    } else {
      const prev = snake[i - 1];
      const next = snake[i + 1];
      const isVertical = prev.x === seg.x && next.x === seg.x;
      const fadeAlpha = 0.7 + 0.3 * (1 - i / snake.length);
      drawSnakeBody(ctx, cx, cy, isVertical, theme, fadeAlpha);
    }
  }
}

function drawApple(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const r = CELL / 2 - 4;
  // Main body
  ctx.beginPath();
  ctx.arc(cx, cy + 1, r, 0, Math.PI * 2);
  ctx.fillStyle = "#e8201a";
  ctx.fill();
  ctx.strokeStyle = "#8b0000";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Highlight
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, cy - r * 0.2, r * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,200,200,0.5)";
  ctx.fill();
  // Stem
  ctx.strokeStyle = "#5a3010";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + 4, cy - r - 5, cx + 2, cy - r - 8);
  ctx.stroke();
  // Leaf
  ctx.fillStyle = "#22aa22";
  ctx.beginPath();
  ctx.ellipse(cx + 4, cy - r - 6, 4, 2, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawSpeedItem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const r = CELL / 2 - 4;
  // Glow circle
  ctx.beginPath();
  ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,150,255,0.15)";
  ctx.fill();
  // Circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#0066cc";
  ctx.fill();
  ctx.strokeStyle = "#44aaff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Lightning bolt
  ctx.fillStyle = "#ffee00";
  ctx.beginPath();
  ctx.moveTo(cx + 2, cy - r + 3);
  ctx.lineTo(cx - 2, cy + 1);
  ctx.lineTo(cx + 1, cy + 1);
  ctx.lineTo(cx - 2, cy + r - 3);
  ctx.lineTo(cx + 3, cy - 1);
  ctx.lineTo(cx - 1, cy - 1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBomb(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  now: number,
) {
  const pulse = 0.85 + 0.15 * Math.sin(now / 200);
  ctx.save();
  ctx.scale(pulse, pulse);
  ctx.translate((cx * (1 - pulse)) / pulse, (cy * (1 - pulse)) / pulse);

  const r = CELL / 2 - 4;
  // Bomb body
  ctx.beginPath();
  ctx.arc(cx, cy + 2, r, 0, Math.PI * 2);
  ctx.fillStyle = "#222";
  ctx.fill();
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Shine
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, cy - r * 0.1, r * 0.25, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fill();
  // Fuse
  ctx.strokeStyle = "#886633";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r + 2);
  ctx.quadraticCurveTo(cx + 6, cy - r - 3, cx + 4, cy - r - 7);
  ctx.stroke();
  // Spark
  const sparkAlpha = 0.5 + 0.5 * Math.sin(now / 80);
  ctx.beginPath();
  ctx.arc(cx + 4, cy - r - 7, 2, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,180,0,${sparkAlpha})`;
  ctx.fill();

  ctx.restore();
}

function drawItems(ctx: CanvasRenderingContext2D, items: Item[], now: number) {
  for (const item of items) {
    const cx = item.pos.x * CELL + CELL / 2;
    const cy = item.pos.y * CELL + CELL / 2;
    if (item.type === "apple") drawApple(ctx, cx, cy);
    else if (item.type === "speed") {
      const alpha =
        item.spawnTime + SPEED_ITEM_LIFETIME - now < 2000
          ? Math.sin(now / 100) * 0.5 + 0.5
          : 1;
      drawSpeedItem(ctx, cx, cy, alpha);
    } else if (item.type === "bomb") drawBomb(ctx, cx, cy, now);
  }
}

function drawEatEffect(
  ctx: CanvasRenderingContext2D,
  effect: { pos: Point; end: number },
  now: number,
) {
  const progress = 1 - (effect.end - now) / EAT_EFFECT_MS;
  if (progress < 0 || progress > 1) return;
  const cx = effect.pos.x * CELL + CELL / 2;
  const cy = effect.pos.y * CELL + CELL / 2;
  const alpha = (1 - progress) * 0.9;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const len = 4 + progress * 10;
    const x1 = cx + Math.cos(angle) * 5;
    const y1 = cy + Math.sin(angle) * 5;
    ctx.strokeStyle = i % 2 === 0 ? "#ffee00" : "#ff8800";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(
      cx + Math.cos(angle) * (5 + len),
      cy + Math.sin(angle) * (5 + len),
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawPausedOverlay(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.fillStyle = "#00ff88";
  ctx.font = "bold 18px 'Press Start 2P', monospace";
  ctx.textAlign = "center";
  ctx.fillText("PAUSED", CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 10);
  ctx.fillStyle = "#aaffcc";
  ctx.font = "9px 'Press Start 2P', monospace";
  ctx.fillText("PRESS P TO RESUME", CANVAS_SIZE / 2, CANVAS_SIZE / 2 + 18);
}

// ---- Component ----
export default function SnakeGame() {
  const { actor } = useActor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameData | null>(null);
  const themeRef = useRef<Theme>("forest");
  const lastTickRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const difficultyRef = useRef<Difficulty>("medium");
  const difficultyConfigRef = useRef<DifficultyConfig>(
    DIFFICULTY_CONFIG.medium,
  );
  const audioCtxRef = useRef<AudioContext | null>(null);
  const getAudioRef = useRef(() => {
    if (!audioCtxRef.current) audioCtxRef.current = createAudioCtx();
    return audioCtxRef.current;
  });

  const [theme, setTheme] = useState<Theme>("forest");
  const [uiScore, setUiScore] = useState(0);
  const [uiHiScore, setUiHiScore] = useState(0);
  const [uiLives, setUiLives] = useState(3);
  const [uiSpeedActive, setUiSpeedActive] = useState(false);
  const [gameState, setGameState] = useState<GameState>("start");
  const [finalScore, setFinalScore] = useState(0);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    if (!actor) return;
    actor
      .getGlobalHiScore()
      .then((v) => setUiHiScore(Number(v)))
      .catch(() => {});
  }, [actor]);

  const submitScore = useCallback(
    (score: number) => {
      if (!actor) return;
      actor
        .submitScore(BigInt(score))
        .then(() => actor.getGlobalHiScore())
        .then((v) => setUiHiScore(Number(v)))
        .catch(() => {});
    },
    [actor],
  );

  const startGame = useCallback((difficulty: Difficulty) => {
    const ac = getAudioRef.current();
    if (ac) sfxStart(ac);
    difficultyRef.current = difficulty;
    difficultyConfigRef.current = DIFFICULTY_CONFIG[difficulty];
    gameRef.current = initGame();
    lastTickRef.current = performance.now();
    setUiScore(0);
    setUiLives(3);
    setUiSpeedActive(false);
    setGameState("playing");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const render = useCallback((now: number) => {
    const canvas = canvasRef.current;
    const g = gameRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const th = themeRef.current;

    drawBoard(ctx, th);
    if (g) {
      drawItems(ctx, g.items, now);
      if (g.snake.length > 0) drawSnake(ctx, g.snake, th, g.dir);
      if (g.eatEffect) drawEatEffect(ctx, g.eatEffect, now);
      if (g.gameState === "paused") drawPausedOverlay(ctx);
    }
  }, []);

  const tick = useCallback(
    (now: number) => {
      const g = gameRef.current;
      if (!g || g.gameState !== "playing") return;

      const cfg = difficultyConfigRef.current;
      const interval = g.speedBoostEnd > now ? cfg.boost : cfg.base;
      if (now - lastTickRef.current < interval) return;
      lastTickRef.current = now;

      g.dir = g.nextDir;

      const head = g.snake[0];
      let nx = head.x;
      let ny = head.y;
      if (g.dir === "UP") ny--;
      else if (g.dir === "DOWN") ny++;
      else if (g.dir === "LEFT") nx--;
      else nx++;

      if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) {
        const ac = getAudioRef.current();
        g.lives--;
        setUiLives(g.lives);
        if (g.lives <= 0) {
          if (ac) sfxGameOver(ac);
          g.gameState = "gameover";
          setFinalScore(g.score);
          setGameState("gameover");
          submitScore(g.score);
        } else {
          if (ac) sfxBomb(ac);
          g.snake = [
            { x: 12, y: 10 },
            { x: 11, y: 10 },
            { x: 10, y: 10 },
          ];
          g.dir = "RIGHT";
          g.nextDir = "RIGHT";
        }
        return;
      }

      const newHead = { x: nx, y: ny };
      if (g.snake.slice(0, -1).some((s) => s.x === nx && s.y === ny)) {
        const ac = getAudioRef.current();
        if (ac) sfxGameOver(ac);
        g.gameState = "gameover";
        setFinalScore(g.score);
        setGameState("gameover");
        submitScore(g.score);
        return;
      }

      let grow = false;
      const hitIdx = g.items.findIndex(
        (it) => it.pos.x === nx && it.pos.y === ny,
      );
      if (hitIdx !== -1) {
        const item = g.items[hitIdx];
        g.eatEffect = { pos: { ...item.pos }, end: Date.now() + EAT_EFFECT_MS };
        g.items.splice(hitIdx, 1);
        const ac = getAudioRef.current();

        if (item.type === "apple") {
          if (ac) sfxEat(ac);
          g.score += 10;
          grow = true;
          g.appleCount++;
          g.bombSpawnCounter++;
          const occ = g.snake.concat(g.items.map((i) => i.pos));
          g.items.push({ pos: randomCell(occ), type: "apple", spawnTime: now });
          if (g.appleCount % 4 === 0) {
            const occ2 = g.snake.concat(g.items.map((i) => i.pos));
            g.items.push({
              pos: randomCell(occ2),
              type: "speed",
              spawnTime: now,
            });
          }
          if (g.bombSpawnCounter >= BOMB_SPAWN_EVERY) {
            g.bombSpawnCounter = 0;
            const occ3 = g.snake.concat(g.items.map((i) => i.pos));
            g.items.push({
              pos: randomCell(occ3),
              type: "bomb",
              spawnTime: now,
            });
          }
          setUiScore(g.score);
        } else if (item.type === "speed") {
          if (ac) sfxSpeed(ac);
          g.score += 5;
          g.speedBoostEnd = now + SPEED_BOOST_MS;
          setUiScore(g.score);
          setUiSpeedActive(true);
          setTimeout(() => setUiSpeedActive(false), SPEED_BOOST_MS);
        } else if (item.type === "bomb") {
          if (ac) sfxBomb(ac);
          g.lives--;
          setUiLives(g.lives);
          if (g.lives <= 0) {
            if (ac) sfxGameOver(ac);
            g.gameState = "gameover";
            setFinalScore(g.score);
            setGameState("gameover");
            submitScore(g.score);
            return;
          }
        }
      }

      g.items = g.items.filter(
        (it) =>
          !(it.type === "speed" && now - it.spawnTime > SPEED_ITEM_LIFETIME),
      );

      g.snake.unshift(newHead);
      if (!grow) g.snake.pop();
    },
    [submitScore],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  const loop = useCallback(
    (now: number) => {
      tick(now);
      render(now);
      rafRef.current = requestAnimationFrame(loop);
    },
    [tick, render],
  );

  useEffect(() => {
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loop]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const g = gameRef.current;
      const gs = g ? g.gameState : null;

      if (gameState === "start" || gameState === "gameover") {
        if (e.key === "1") {
          startGame("easy");
          return;
        }
        if (e.key === "2" || e.key === "Enter") {
          startGame("medium");
          return;
        }
        if (e.key === "3") {
          startGame("hard");
          return;
        }
      }

      if (!g) return;

      if (e.key === "p" || e.key === "P" || e.key === "Escape") {
        const ac = getAudioRef.current();
        if (gs === "playing") {
          if (ac) sfxPause(ac);
          g.gameState = "paused";
          setGameState("paused");
        } else if (gs === "paused") {
          if (ac) sfxPause(ac);
          g.gameState = "playing";
          setGameState("playing");
          lastTickRef.current = performance.now();
        }
        return;
      }

      if (gs !== "playing") return;

      const dirMap: Record<string, Direction> = {
        ArrowUp: "UP",
        w: "UP",
        W: "UP",
        ArrowDown: "DOWN",
        s: "DOWN",
        S: "DOWN",
        ArrowLeft: "LEFT",
        a: "LEFT",
        A: "LEFT",
        ArrowRight: "RIGHT",
        d: "RIGHT",
        D: "RIGHT",
      };
      const newDir = dirMap[e.key];
      if (!newDir) return;
      const opposite: Record<Direction, Direction> = {
        UP: "DOWN",
        DOWN: "UP",
        LEFT: "RIGHT",
        RIGHT: "LEFT",
      };
      if (newDir !== opposite[g.dir]) g.nextDir = newDir;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key))
        e.preventDefault();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [startGame, gameState]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTheme = () =>
    setTheme((t) => (t === "forest" ? "neon" : "forest"));

  const accentColor = theme === "neon" ? "#00ffff" : "#4cff4c";
  const bgColor = theme === "neon" ? "#050510" : "#0a1a0a";

  const diffBtnStyle = (
    diff: Difficulty,
    color: string,
  ): React.CSSProperties => ({
    background: "transparent",
    border: `2px solid ${color}`,
    color,
    fontFamily: "'Press Start 2P', monospace",
    fontSize: 10,
    padding: "10px 18px",
    cursor: "pointer",
    letterSpacing: 1,
    textShadow: `0 0 8px ${color}`,
    boxShadow: difficultyRef.current === diff ? `0 0 12px ${color}` : "none",
    transition: "all 0.15s",
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: bgColor,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        fontFamily: "'Press Start 2P', monospace",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
        .diff-btn:hover { opacity: 0.85; transform: scale(1.05); }
      `}</style>

      {/* HUD */}
      <div
        style={{
          width: CANVAS_SIZE,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
          color: accentColor,
          fontSize: 10,
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <div>
          <div>SCORE</div>
          <div style={{ fontSize: 14, color: "#fff" }}>
            {String(uiScore).padStart(5, "0")}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div>HI-SCORE</div>
          <div style={{ fontSize: 14, color: "#ffdd00" }}>
            {String(uiHiScore).padStart(5, "0")}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div>LIVES</div>
          <div style={{ fontSize: 14 }}>{"❤️".repeat(Math.max(0, uiLives))}</div>
        </div>
      </div>

      {/* CRT wrapper — only canvas gets the filter */}
      <div
        style={{
          position: "relative",
          width: CANVAS_SIZE,
          height: CANVAS_SIZE,
        }}
      >
        {/* SVG filter definition */}
        <svg
          aria-hidden="true"
          style={{ position: "absolute", width: 0, height: 0 }}
        >
          <defs>
            <filter id="crt-bulge" x="-5%" y="-5%" width="110%" height="110%">
              <feDisplacementMap
                in="SourceGraphic"
                in2="SourceGraphic"
                scale="0"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
        </svg>

        {/* Canvas with CRT styling — NO text overlay inside this */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "10% / 7%",
            overflow: "hidden",
            boxShadow: `0 0 0 3px #111, 0 0 0 6px #333,
              inset 0 0 60px rgba(0,0,0,0.5),
              0 0 30px ${
                theme === "neon"
                  ? "rgba(0,255,255,0.3)"
                  : "rgba(76,255,76,0.25)"
              }`,
          }}
        >
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            tabIndex={0}
            style={{
              display: "block",
              cursor: "none",
              imageRendering: "pixelated",
              width: CANVAS_SIZE,
              height: CANVAS_SIZE,
              borderRadius: "inherit",
            }}
          />
          {/* Scanlines overlay */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "repeating-linear-gradient(to bottom, transparent 0px, transparent 3px, rgba(0,0,0,0.12) 3px, rgba(0,0,0,0.12) 4px)",
              pointerEvents: "none",
            }}
          />
          {/* Screen glare */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.04) 0%, transparent 60%)",
              pointerEvents: "none",
            }}
          />
        </div>

        {/* Overlays — outside filter, text is crisp */}
        {gameState === "start" && (
          <div
            data-ocid="start_menu.panel"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.9)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 20,
              borderRadius: "10% / 7%",
            }}
          >
            <div
              style={{
                color: "#00ff88",
                fontSize: 22,
                textShadow: "0 0 12px #00ff88, 0 0 30px #00ff66",
                letterSpacing: 2,
                textAlign: "center",
                lineHeight: 1.6,
              }}
            >
              RETRO
              <br />
              SNAKE
            </div>
            <div style={{ color: "#aaffcc", fontSize: 9, letterSpacing: 2 }}>
              SELECT DIFFICULTY
            </div>
            <div
              style={{
                display: "flex",
                gap: 14,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <button
                data-ocid="start_menu.easy.button"
                className="diff-btn"
                style={diffBtnStyle("easy", "#44ff88")}
                onClick={() => startGame("easy")}
                type="button"
              >
                [1] EASY
              </button>
              <button
                data-ocid="start_menu.medium.button"
                className="diff-btn"
                style={diffBtnStyle("medium", "#ffdd00")}
                onClick={() => startGame("medium")}
                type="button"
              >
                [2] MED
              </button>
              <button
                data-ocid="start_menu.hard.button"
                className="diff-btn"
                style={diffBtnStyle("hard", "#ff4444")}
                onClick={() => startGame("hard")}
                type="button"
              >
                [3] HARD
              </button>
            </div>
            <div
              style={{
                color: "#445544",
                fontSize: 7,
                textAlign: "center",
                lineHeight: 1.8,
              }}
            >
              WASD / ARROWS: MOVE &nbsp;·&nbsp; P: PAUSE
            </div>
          </div>
        )}

        {gameState === "gameover" && (
          <div
            data-ocid="gameover.panel"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.9)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 18,
              borderRadius: "10% / 7%",
            }}
          >
            <div
              style={{
                color: "#ff4444",
                fontSize: 20,
                textShadow: "0 0 12px #ff4444, 0 0 30px #ff2222",
                letterSpacing: 2,
                textAlign: "center",
                lineHeight: 1.6,
              }}
            >
              GAME
              <br />
              OVER
            </div>
            <div style={{ color: "#ffdd00", fontSize: 11 }}>
              SCORE: {String(finalScore).padStart(5, "0")}
            </div>
            <div style={{ color: "#aaffcc", fontSize: 9, letterSpacing: 2 }}>
              PLAY AGAIN?
            </div>
            <div
              style={{
                display: "flex",
                gap: 14,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <button
                data-ocid="gameover.easy.button"
                className="diff-btn"
                style={diffBtnStyle("easy", "#44ff88")}
                onClick={() => startGame("easy")}
                type="button"
              >
                [1] EASY
              </button>
              <button
                data-ocid="gameover.medium.button"
                className="diff-btn"
                style={diffBtnStyle("medium", "#ffdd00")}
                onClick={() => startGame("medium")}
                type="button"
              >
                [2] MED
              </button>
              <button
                data-ocid="gameover.hard.button"
                className="diff-btn"
                style={diffBtnStyle("hard", "#ff4444")}
                onClick={() => startGame("hard")}
                type="button"
              >
                [3] HARD
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div
        style={{
          width: CANVAS_SIZE,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 12,
          color: accentColor,
          fontSize: 8,
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <div>WASD / ARROWS: MOVE &nbsp;·&nbsp; P: PAUSE</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {uiSpeedActive && <span style={{ color: "#44aaff" }}>⚡ SPEED!</span>}
          <button
            data-ocid="theme.toggle"
            onClick={toggleTheme}
            type="button"
            style={{
              background: "transparent",
              border: `1px solid ${accentColor}`,
              color: accentColor,
              fontFamily: "'Press Start 2P', monospace",
              fontSize: 8,
              padding: "4px 8px",
              cursor: "pointer",
            }}
          >
            {theme === "forest" ? "NEON" : "FOREST"}
          </button>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: 20,
          color: "#445544",
          fontSize: 7,
          fontFamily: "'Press Start 2P', monospace",
        }}
      >
        © {new Date().getFullYear()}.{" "}
        <a
          href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#556655", textDecoration: "none" }}
        >
          Built with ♥ using caffeine.ai
        </a>
      </div>
    </div>
  );
}
