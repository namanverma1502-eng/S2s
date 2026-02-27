import React, { useRef, useEffect, useState, useCallback } from "react";

// ============================================================
// TYPES
// ============================================================

type Screen = "title" | "characterSelect" | "game" | "roundEnd" | "gameOver";

interface Character {
  id: string;
  name: string;
  color: string;
  glowColor: string;
  speed: number;
  strength: number;
  abilityName: string;
  abilityDesc: string;
  emoji: string;
  statsDisplay: { speed: number; strength: number };
}

interface Entity {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  grounded: boolean;
  facing: 1 | -1; // 1 = right, -1 = left
  character: Character;
  isPlayer: boolean;
  playerIndex: number; // 0 = AI, 1/2/3 = human player
  health: number; // lives remaining this set
  alive: boolean; // alive in current round
  stunTimer: number;
  attackCooldown: number;
  abilityCooldown: number;
  wobble: number; // visual wobble offset
  wobbleDir: number;
  hitFlash: number; // frames of hit flash
  // AI state
  aiState: "roam" | "chase" | "flee" | "attack";
  aiTimer: number;
  aiTarget: number | null; // entity index
}

interface Platform {
  x: number;
  y: number;
  width: number;
  height: number;
  isMain: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface DecoyEffect {
  x: number;
  y: number;
  life: number;
  color: string;
  alpha: number;
}

interface GameState {
  entities: Entity[];
  platforms: Platform[];
  particles: Particle[];
  decoys: DecoyEffect[];
  round: number;
  roundTimer: number;
  scores: number[]; // per entity index
  phase: "playing" | "roundEnd" | "gameOver";
  roundWinnerId: string | null;
  finalWinnerId: string | null;
  keys: Record<string, boolean>;
  lastTime: number;
  frameCount: number;
  stars: Array<{ x: number; y: number; size: number; twinkle: number }>;
  buntingFlags: Array<{ x: number; y: number; color: string; angle: number }>;
}

// ============================================================
// CONSTANTS
// ============================================================

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 520;
const GRAVITY = 0.55;
const MAX_FALL_SPEED = 18;
const JUMP_FORCE = -14;
const FRICTION = 0.82;
const ATTACK_RANGE = 55;
const ATTACK_COOLDOWN = 25; // frames
const ABILITY_COOLDOWN = 480; // ~8 seconds at 60fps
const ROUND_TIME = 60; // seconds

// Per-player key bindings (playerIndex 1/2/3)
const PLAYER_KEYS: Record<number, {
  left: string[];
  right: string[];
  jump: string[];
  attack: string[];
  ability: string[];
}> = {
  1: { left: ["ArrowLeft"], right: ["ArrowRight"], jump: ["ArrowUp", " "], attack: ["e", "E"], ability: ["q", "Q"] },
  2: { left: ["a", "A"], right: ["d", "D"], jump: ["w", "W"], attack: ["f", "F"], ability: ["g", "G"] },
  3: { left: ["j", "J"], right: ["l", "L"], jump: ["i", "I"], attack: ["o", "O"], ability: ["p", "P"] },
};

// Player display colors for UI badges
const PLAYER_COLORS: Record<number, string> = {
  1: "#FFD93D",
  2: "#4FACFE",
  3: "#6BFFB8",
};

const PLATFORMS: Platform[] = [
  // Main platform
  { x: 150, y: 360, width: 600, height: 30, isMain: true },
  // Left small platform
  { x: 100, y: 260, width: 160, height: 20, isMain: false },
  // Right small platform
  { x: 640, y: 260, width: 160, height: 20, isMain: false },
  // Center high platform
  { x: 360, y: 190, width: 180, height: 20, isMain: false },
];

const CHARACTERS: Character[] = [
  {
    id: "speed-runner",
    name: "Speed Runner",
    color: "#4FACFE",
    glowColor: "rgba(79,172,254,0.6)",
    speed: 7,
    strength: 3,
    abilityName: "Dash",
    abilityDesc: "Burst of speed forward, phasing through opponents",
    emoji: "💨",
    statsDisplay: { speed: 5, strength: 2 },
  },
  {
    id: "heavy-brawler",
    name: "Heavy Brawler",
    color: "#FF6B6B",
    glowColor: "rgba(255,107,107,0.6)",
    speed: 3.5,
    strength: 8,
    abilityName: "Ground Slam",
    abilityDesc: "Shockwave around self, sends everyone flying",
    emoji: "💥",
    statsDisplay: { speed: 2, strength: 5 },
  },
  {
    id: "puzzle-genius",
    name: "Puzzle Genius",
    color: "#FFD93D",
    glowColor: "rgba(255,217,61,0.6)",
    speed: 5,
    strength: 5,
    abilityName: "Stun Blast",
    abilityDesc: "Stuns all nearby enemies for 2 seconds",
    emoji: "⚡",
    statsDisplay: { speed: 3, strength: 3 },
  },
  {
    id: "trickster",
    name: "Trickster",
    color: "#C77DFF",
    glowColor: "rgba(199,125,255,0.6)",
    speed: 6,
    strength: 4,
    abilityName: "Decoy",
    abilityDesc: "Leaves a clone to confuse AI opponents",
    emoji: "🎭",
    statsDisplay: { speed: 4, strength: 3 },
  },
];

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function createEntity(
  id: string,
  x: number,
  character: Character,
  isPlayer: boolean,
  playerIndex: number = 0
): Entity {
  return {
    id,
    x,
    y: 300,
    vx: 0,
    vy: 0,
    width: 46,
    height: 50,
    grounded: false,
    facing: 1,
    character,
    isPlayer,
    playerIndex,
    health: 3,
    alive: true,
    stunTimer: 0,
    attackCooldown: 0,
    abilityCooldown: 0,
    wobble: 0,
    wobbleDir: 1,
    hitFlash: 0,
    aiState: "roam",
    aiTimer: 0,
    aiTarget: null,
  };
}

function spawnParticles(
  particles: Particle[],
  x: number,
  y: number,
  color: string,
  count: number,
  force: number = 5
): void {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * force * (0.5 + Math.random()),
      vy: Math.sin(angle) * force * (0.5 + Math.random()) - 2,
      life: 30 + Math.random() * 20,
      maxLife: 50,
      color,
      size: 3 + Math.random() * 4,
    });
  }
}

function checkPlatformCollision(entity: Entity, platforms: Platform[]): void {
  entity.grounded = false;
  for (const plat of platforms) {
    const prevBottom = entity.y + entity.height - entity.vy;
    const currBottom = entity.y + entity.height;
    if (
      entity.x + entity.width > plat.x + 5 &&
      entity.x < plat.x + plat.width - 5 &&
      currBottom >= plat.y &&
      prevBottom <= plat.y + 5 &&
      entity.vy >= 0
    ) {
      entity.y = plat.y - entity.height;
      entity.vy = 0;
      entity.grounded = true;
      break;
    }
  }
}

function dist(a: Entity, b: Entity): number {
  const cx1 = a.x + a.width / 2;
  const cy1 = a.y + a.height / 2;
  const cx2 = b.x + b.width / 2;
  const cy2 = b.y + b.height / 2;
  return Math.sqrt((cx2 - cx1) ** 2 + (cy2 - cy1) ** 2);
}

// ============================================================
// DRAW FUNCTIONS
// ============================================================

function drawBackground(
  ctx: CanvasRenderingContext2D,
  stars: GameState["stars"],
  frameCount: number
): void {
  // Sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  skyGrad.addColorStop(0, "#0d0a1e");
  skyGrad.addColorStop(0.5, "#1a0a2e");
  skyGrad.addColorStop(1, "#0f1535");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Stars
  for (const star of stars) {
    const twinkle = Math.sin(frameCount * 0.05 + star.twinkle);
    const alpha = 0.4 + twinkle * 0.4;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fill();
  }

  // Atmospheric glow at horizon
  const horizGrad = ctx.createRadialGradient(
    CANVAS_WIDTH / 2, CANVAS_HEIGHT, 0,
    CANVAS_WIDTH / 2, CANVAS_HEIGHT, 300
  );
  horizGrad.addColorStop(0, "rgba(120,50,200,0.15)");
  horizGrad.addColorStop(1, "transparent");
  ctx.fillStyle = horizGrad;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

function drawBuntingFlags(
  ctx: CanvasRenderingContext2D,
  flags: GameState["buntingFlags"],
  frameCount: number
): void {
  const colors = ["#FF6B6B", "#FFD93D", "#4FACFE", "#C77DFF", "#6BFFB8", "#FF9F43"];
  const flagCount = 20;
  const y0 = 30;
  const yAmp = 12;

  // Draw rope
  ctx.beginPath();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= flagCount; i++) {
    const t = i / flagCount;
    const x = t * CANVAS_WIDTH;
    const sag = Math.sin(t * Math.PI) * 8;
    const y = y0 + sag + Math.sin(frameCount * 0.02 + t * 4) * 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Draw triangle flags
  for (let i = 0; i < flagCount; i++) {
    const t = i / flagCount;
    const x = t * CANVAS_WIDTH + CANVAS_WIDTH / flagCount / 2;
    const sag = Math.sin(t * Math.PI) * 8;
    const y = y0 + sag + Math.sin(frameCount * 0.02 + t * 4) * 2;
    const wave = Math.sin(frameCount * 0.04 + i * 0.8) * 3;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(wave * 0.05);

    const color = colors[i % colors.length];
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(8, 0);
    ctx.lineTo(wave * 0.5, 18);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.restore();
  }
}

function drawPlatforms(ctx: CanvasRenderingContext2D, platforms: Platform[]): void {
  for (const plat of platforms) {
    if (plat.isMain) {
      // Main platform — wooden with carnival stripes
      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      ctx.roundRect(plat.x + 6, plat.y + 8, plat.width, plat.height, 8);
      ctx.fill();

      // Wood base
      const woodGrad = ctx.createLinearGradient(plat.x, plat.y, plat.x, plat.y + plat.height);
      woodGrad.addColorStop(0, "#c8853a");
      woodGrad.addColorStop(0.4, "#b87330");
      woodGrad.addColorStop(1, "#9a5f20");
      ctx.fillStyle = woodGrad;
      ctx.beginPath();
      ctx.roundRect(plat.x, plat.y, plat.width, plat.height, 8);
      ctx.fill();

      // Wood grain lines
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 1;
      for (let gx = plat.x + 20; gx < plat.x + plat.width - 10; gx += 40) {
        ctx.beginPath();
        ctx.moveTo(gx, plat.y + 4);
        ctx.lineTo(gx, plat.y + plat.height - 4);
        ctx.stroke();
      }

      // Carnival stripes on side edges
      const stripeColors = ["#FF6B6B", "#FFD93D", "#4FACFE", "#C77DFF", "#6BFFB8"];
      const stripeW = 12;
      const stripeCount = Math.floor(plat.width / stripeW);
      for (let si = 0; si < stripeCount; si++) {
        const sx = plat.x + si * stripeW;
        if (sx + stripeW > plat.x + plat.width) break;
        ctx.fillStyle = stripeColors[si % stripeColors.length];
        ctx.fillRect(sx, plat.y + plat.height - 8, stripeW, 8);
      }

      // Top highlight
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.beginPath();
      ctx.roundRect(plat.x + 4, plat.y, plat.width - 8, 6, [4, 4, 0, 0]);
      ctx.fill();

      // Neon edge glow
      ctx.strokeStyle = "rgba(255,200,50,0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(plat.x, plat.y, plat.width, plat.height, 8);
      ctx.stroke();
    } else {
      // Small floating platforms
      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.roundRect(plat.x + 4, plat.y + 5, plat.width, plat.height, 6);
      ctx.fill();

      // Platform body
      const smallGrad = ctx.createLinearGradient(plat.x, plat.y, plat.x, plat.y + plat.height);
      smallGrad.addColorStop(0, "#9b5de5");
      smallGrad.addColorStop(1, "#7b2fd4");
      ctx.fillStyle = smallGrad;
      ctx.beginPath();
      ctx.roundRect(plat.x, plat.y, plat.width, plat.height, 6);
      ctx.fill();

      // Neon edge
      ctx.strokeStyle = "rgba(199,125,255,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(plat.x, plat.y, plat.width, plat.height, 6);
      ctx.stroke();

      // Top highlight
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.beginPath();
      ctx.roundRect(plat.x + 3, plat.y, plat.width - 6, 5, [3, 3, 0, 0]);
      ctx.fill();
    }
  }
}

function drawEntity(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  frameCount: number
): void {
  if (!entity.alive) return;

  const cx = entity.x + entity.width / 2;
  const cy = entity.y + entity.height / 2;
  const r = entity.width / 2;

  ctx.save();
  ctx.translate(cx, cy);

  // Wobble when moving
  if (Math.abs(entity.vx) > 1) {
    const wobbleAmt = Math.sin(frameCount * 0.3) * 2;
    ctx.rotate(wobbleAmt * 0.04 * entity.facing);
    const scaleX = 1 + Math.sin(frameCount * 0.25) * 0.03;
    const scaleY = 1 - Math.sin(frameCount * 0.25) * 0.03;
    ctx.scale(scaleX * entity.facing, scaleY);
  } else {
    ctx.scale(entity.facing, 1);
  }

  const isFlashing = entity.hitFlash > 0 && Math.floor(entity.hitFlash / 3) % 2 === 0;
  const isStunned = entity.stunTimer > 0;
  const bodyColor = isFlashing ? "#ffffff" : entity.character.color;

  // Outer glow
  if (!isFlashing) {
    const glowGrad = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.8);
    glowGrad.addColorStop(0, entity.character.glowColor);
    glowGrad.addColorStop(1, "transparent");
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Shadow on ground
  if (entity.grounded) {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, entity.height / 2 - 4, r * 0.8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Body circle with gradient
  const bodyGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r);
  bodyGrad.addColorStop(0, lightenColor(bodyColor, 40));
  bodyGrad.addColorStop(0.6, bodyColor);
  bodyGrad.addColorStop(1, darkenColor(bodyColor, 30));
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // Stun sparkles
  if (isStunned) {
    ctx.fillStyle = "#FFD93D";
    for (let i = 0; i < 3; i++) {
      const sparkAngle = (frameCount * 0.15 + (i * Math.PI * 2) / 3);
      const sx = Math.cos(sparkAngle) * (r + 8);
      const sy = Math.sin(sparkAngle) * (r + 8) - 5;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Eyes
  const eyeY = -r * 0.15;
  const eyeSpacing = r * 0.35;

  // Left eye
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(-eyeSpacing, eyeY, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a1a2e";
  ctx.beginPath();
  ctx.arc(-eyeSpacing + 1.5, eyeY + 1, r * 0.14, 0, Math.PI * 2);
  ctx.fill();

  // Right eye
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(eyeSpacing, eyeY, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a1a2e";
  ctx.beginPath();
  ctx.arc(eyeSpacing + 1.5, eyeY + 1, r * 0.14, 0, Math.PI * 2);
  ctx.fill();

  // Mouth
  if (isStunned) {
    // Dizzy x eyes
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-eyeSpacing - 4, eyeY - 4);
    ctx.lineTo(-eyeSpacing + 4, eyeY + 4);
    ctx.moveTo(-eyeSpacing + 4, eyeY - 4);
    ctx.lineTo(-eyeSpacing - 4, eyeY + 4);
    ctx.moveTo(eyeSpacing - 4, eyeY - 4);
    ctx.lineTo(eyeSpacing + 4, eyeY + 4);
    ctx.moveTo(eyeSpacing + 4, eyeY - 4);
    ctx.lineTo(eyeSpacing - 4, eyeY + 4);
    ctx.stroke();
  } else {
    // Happy/normal mouth
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, r * 0.25, r * 0.3, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }

  ctx.restore();

  // Name tag above character
  const tagY = entity.y - 22;
  ctx.save();
  ctx.font = "bold 11px 'Nunito', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const label = entity.playerIndex > 0 ? `P${entity.playerIndex}` : entity.character.name.split(" ")[0];
  const textWidth = ctx.measureText(label).width + 10;

  // Tag background
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  ctx.roundRect(cx - textWidth / 2, tagY - 8, textWidth, 16, 4);
  ctx.fill();

  // Tag border
  ctx.strokeStyle = entity.character.color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Tag text
  const playerLabelColor = entity.playerIndex > 0 ? (PLAYER_COLORS[entity.playerIndex] ?? "#FFD93D") : "#fff";
  ctx.fillStyle = playerLabelColor;
  ctx.fillText(label, cx, tagY);
  ctx.restore();

  // Ability cooldown indicator (ring under character)
  if (entity.abilityCooldown > 0) {
    const cooldownPct = entity.abilityCooldown / ABILITY_COOLDOWN;
    const arcRadius = r + 10;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, arcRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = entity.character.color;
    ctx.beginPath();
    ctx.arc(0, 0, arcRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - cooldownPct));
    ctx.stroke();
    ctx.restore();
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): void {
  for (const p of particles) {
    const alpha = p.life / p.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawDecoys(ctx: CanvasRenderingContext2D, decoys: DecoyEffect[]): void {
  for (const d of decoys) {
    ctx.save();
    ctx.globalAlpha = d.alpha * 0.7;
    ctx.strokeStyle = d.color;
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(d.x, d.y, 23, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = d.color;
    ctx.globalAlpha = d.alpha * 0.3;
    ctx.beginPath();
    ctx.arc(d.x, d.y, 23, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawHUD(
  ctx: CanvasRenderingContext2D,
  entities: Entity[],
  scores: number[],
  round: number,
  roundTimer: number
): void {
  // Score panel background
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.roundRect(8, 8, CANVAS_WIDTH - 16, 48, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(199,125,255,0.3)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = "bold 13px 'Nunito', sans-serif";
  ctx.textBaseline = "middle";

  // Draw entity scores
  const scoreY = 32;
  const scoreSlotW = Math.min(220, Math.floor((CANVAS_WIDTH - 140) / entities.length));
  const offsetX = 20;

  entities.forEach((e, i) => {
    const sx = offsetX + i * scoreSlotW;

    // Character color dot
    ctx.fillStyle = e.character.color;
    ctx.beginPath();
    ctx.arc(sx + 8, scoreY, 7, 0, Math.PI * 2);
    ctx.fill();

    // Hearts for lives
    const hearts = e.health;
    for (let h = 0; h < 3; h++) {
      ctx.fillStyle = h < hearts ? "#FF6B6B" : "rgba(255,255,255,0.15)";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("♥", sx + 22 + h * 18, scoreY + 1);
    }

    // Name
    ctx.font = "bold 12px 'Nunito', sans-serif";
    ctx.fillStyle = e.playerIndex > 0 ? (PLAYER_COLORS[e.playerIndex] ?? "#FFD93D") : "rgba(255,255,255,0.8)";
    ctx.textAlign = "left";
    const label = e.playerIndex > 0 ? `P${e.playerIndex}` : `AI`;
    ctx.fillText(label, sx + 78, scoreY);

    // Round score (wins)
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(`${scores[i]}W`, sx + 118, scoreY);

    // Eliminated indicator
    if (!e.alive) {
      ctx.fillStyle = "rgba(255,100,100,0.9)";
      ctx.font = "bold 10px 'Nunito', sans-serif";
      ctx.fillText("OUT", sx + 150, scoreY);
    }
  });

  // Round info (center-right)
  ctx.textAlign = "center";
  ctx.font = "bold 13px 'Fredoka One', cursive";
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText(`Round ${round} of 3`, CANVAS_WIDTH / 2, scoreY);

  // Timer (right side)
  const timerX = CANVAS_WIDTH - 55;
  const timeLeft = Math.max(0, Math.ceil(roundTimer));
  const timerColor = timeLeft <= 10 ? "#FF6B6B" : "#FFD93D";
  ctx.font = "bold 22px 'Fredoka One', cursive";
  ctx.fillStyle = timerColor;
  ctx.textAlign = "center";
  ctx.fillText(`${timeLeft}`, timerX, scoreY);

  // Controls hint (bottom)
  ctx.font = "11px 'Nunito', sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.textAlign = "center";
  ctx.fillText("P1: ←/→ Move  ↑/Space Jump  E Attack  Q Special   |   P2: A/D W F G   |   P3: J/L I O P", CANVAS_WIDTH / 2, CANVAS_HEIGHT - 8);
}

// ============================================================
// COLOR HELPERS
// ============================================================

function lightenColor(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.min(255, r + amount)},${Math.min(255, g + amount)},${Math.min(255, b + amount)})`;
}

function darkenColor(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.max(0, r - amount)},${Math.max(0, g - amount)},${Math.max(0, b - amount)})`;
}

// ============================================================
// AI LOGIC
// ============================================================

function updateAI(entity: Entity, entities: Entity[], platforms: Platform[], frameCount: number): void {
  if (!entity.alive || entity.stunTimer > 0) return;

  entity.aiTimer--;

  // Find nearest alive enemy
  const aliveEnemies = entities.filter(e => e.alive && e.id !== entity.id);
  if (aliveEnemies.length === 0) return;

  // Sort by distance
  aliveEnemies.sort((a, b) => dist(entity, a) - dist(entity, b));
  const target = aliveEnemies[0];
  const dToTarget = dist(entity, target);

  // Check if near edge
  const mainPlat = platforms.find(p => p.isMain)!;
  const nearLeftEdge = entity.x < mainPlat.x + 50;
  const nearRightEdge = entity.x + entity.width > mainPlat.x + mainPlat.width - 50;
  const nearEdge = nearLeftEdge || nearRightEdge;

  // AI state machine
  if (entity.aiTimer <= 0) {
    // Re-evaluate every ~30-60 frames
    entity.aiTimer = 30 + Math.floor(Math.random() * 30);

    if (nearEdge && Math.random() < 0.5) {
      entity.aiState = "flee";
    } else if (dToTarget < 120) {
      entity.aiState = "attack";
    } else {
      entity.aiState = "chase";
    }
  }

  const aggression = entity.character.strength / 8; // 0-1
  const speed = entity.character.speed;
  const cx = entity.x + entity.width / 2;
  const targetCx = target.x + target.width / 2;

  switch (entity.aiState) {
    case "chase":
    case "attack": {
      // Move toward target
      const dir = targetCx > cx ? 1 : -1;
      entity.vx += dir * speed * 0.15;
      entity.facing = dir as 1 | -1;

      // Attack if close enough
      if (dToTarget < ATTACK_RANGE + 20 && entity.attackCooldown <= 0) {
        // Entity attack handled in update loop
        entity.attackCooldown = ATTACK_COOLDOWN + Math.floor(Math.random() * 20);
        // Deal knockback to target entity directly
        const knockDir = targetCx > cx ? 1 : -1;
        target.vx += knockDir * (entity.character.strength * 1.2);
        target.vy -= entity.character.strength * 0.8;
        target.hitFlash = 18;
        spawnParticlesGlobal(target.x + target.width / 2, target.y + target.height / 2, entity.character.color);
      }

      // Jump to reach platforms above
      if (entity.grounded && Math.random() < 0.02 * aggression) {
        entity.vy = JUMP_FORCE;
        entity.grounded = false;
      }

      // Use ability occasionally
      if (entity.abilityCooldown <= 0 && Math.random() < 0.005) {
        entity.abilityCooldown = ABILITY_COOLDOWN;
      }
      break;
    }

    case "flee": {
      // Move away from edges and away from target
      const safeDir = nearLeftEdge ? 1 : -1;
      entity.vx += safeDir * speed * 0.2;
      entity.facing = safeDir as 1 | -1;

      // Jump if cornered
      if (entity.grounded && nearEdge && Math.random() < 0.05) {
        entity.vy = JUMP_FORCE;
        entity.grounded = false;
      }
      break;
    }

    case "roam": {
      // Random direction with some wandering
      if (Math.random() < 0.03) {
        entity.vx += (Math.random() - 0.5) * speed * 0.4;
      }
      if (entity.grounded && Math.random() < 0.01) {
        entity.vy = JUMP_FORCE * 0.8;
        entity.grounded = false;
      }
      break;
    }
  }

  // Clamp horizontal speed
  entity.vx = Math.max(-speed, Math.min(speed, entity.vx));
}

// Global particle spawner reference (set during game loop)
let spawnParticlesGlobal: (x: number, y: number, color: string) => void = () => {};

// ============================================================
// GAME UPDATE
// ============================================================

function updateGame(state: GameState, deltaTime: number): void {
  const dt = Math.min(deltaTime, 50) / 16.67; // normalize to 60fps
  state.frameCount++;

  if (state.phase !== "playing") return;

  // Update timer
  state.roundTimer -= deltaTime / 1000;
  if (state.roundTimer <= 0) {
    state.roundTimer = 0;
    endRound(state);
    return;
  }

  // Set up global particle spawner
  spawnParticlesGlobal = (x, y, color) => {
    spawnParticles(state.particles, x, y, color, 8, 6);
  };

  // Human player input (all players with playerIndex > 0)
  for (const humanEntity of state.entities) {
    if (humanEntity.playerIndex <= 0 || !humanEntity.alive || humanEntity.stunTimer > 0) continue;
    const keys = state.keys;
    const spd = humanEntity.character.speed;
    const bindings = PLAYER_KEYS[humanEntity.playerIndex];
    if (!bindings) continue;

    if (bindings.left.some(k => keys[k])) {
      humanEntity.vx -= spd * 0.35;
      humanEntity.facing = -1;
    }
    if (bindings.right.some(k => keys[k])) {
      humanEntity.vx += spd * 0.35;
      humanEntity.facing = 1;
    }
    if (bindings.jump.some(k => keys[k]) && humanEntity.grounded) {
      humanEntity.vy = JUMP_FORCE;
      humanEntity.grounded = false;
    }
    if (bindings.attack.some(k => keys[k]) && humanEntity.attackCooldown <= 0) {
      performAttack(humanEntity, state);
    }
    if (bindings.ability.some(k => keys[k]) && humanEntity.abilityCooldown <= 0) {
      performAbility(humanEntity, state);
    }

    // Clamp horizontal speed
    humanEntity.vx = Math.max(-spd, Math.min(spd, humanEntity.vx));
  }

  // Update all entities
  for (const entity of state.entities) {
    if (!entity.alive) continue;

    // AI logic
    if (!entity.isPlayer) {
      updateAI(entity, state.entities, state.platforms, state.frameCount);
    }

    // Apply gravity
    entity.vy += GRAVITY * dt;
    if (entity.vy > MAX_FALL_SPEED) entity.vy = MAX_FALL_SPEED;

    // Apply friction
    entity.vx *= FRICTION;

    // Move
    entity.x += entity.vx * dt;
    entity.y += entity.vy * dt;

    // Platform collision
    checkPlatformCollision(entity, state.platforms);

    // Timers
    if (entity.stunTimer > 0) entity.stunTimer -= dt;
    if (entity.attackCooldown > 0) entity.attackCooldown -= dt;
    if (entity.abilityCooldown > 0) entity.abilityCooldown -= dt;
    if (entity.hitFlash > 0) entity.hitFlash -= dt;

    // Wall bounds (soft bounce off canvas sides)
    if (entity.x < 0) {
      entity.x = 0;
      entity.vx = Math.abs(entity.vx) * 0.5;
    }
    if (entity.x + entity.width > CANVAS_WIDTH) {
      entity.x = CANVAS_WIDTH - entity.width;
      entity.vx = -Math.abs(entity.vx) * 0.5;
    }

    // Fall off = eliminated from round
    if (entity.y > CANVAS_HEIGHT + 20) {
      eliminateFromRound(entity, state);
    }
  }

  // Update particles
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.15;
    p.life -= dt;
    if (p.life <= 0) state.particles.splice(i, 1);
  }

  // Update decoys
  for (let i = state.decoys.length - 1; i >= 0; i--) {
    const d = state.decoys[i];
    d.life -= dt;
    d.alpha = d.life / 120;
    if (d.life <= 0) state.decoys.splice(i, 1);
  }

  // Check round end
  const aliveCount = state.entities.filter(e => e.alive).length;
  if (aliveCount <= 1) {
    endRound(state);
  }
}

function performAttack(attacker: Entity, state: GameState): void {
  attacker.attackCooldown = ATTACK_COOLDOWN;

  const attackX = attacker.x + attacker.width / 2 + attacker.facing * ATTACK_RANGE;
  const attackY = attacker.y + attacker.height / 2;

  spawnParticles(state.particles, attackX, attackY, attacker.character.color, 6, 5);

  for (const target of state.entities) {
    if (target.id === attacker.id || !target.alive) continue;

    const tx = target.x + target.width / 2;
    const ty = target.y + target.height / 2;
    const hitDist = Math.sqrt((tx - attackX) ** 2 + (ty - attackY) ** 2);

    if (hitDist < ATTACK_RANGE + 10) {
      const kbDir = tx > attacker.x + attacker.width / 2 ? 1 : -1;
      const kbForce = attacker.character.strength;
      target.vx += kbDir * kbForce * 1.5;
      target.vy -= kbForce * 0.9;
      target.hitFlash = 20;

      spawnParticles(state.particles, tx, ty, "#FFD93D", 10, 7);
    }
  }
}

function performAbility(user: Entity, state: GameState): void {
  user.abilityCooldown = ABILITY_COOLDOWN;

  switch (user.character.id) {
    case "speed-runner": {
      // Dash — burst of speed forward
      user.vx += user.facing * user.character.speed * 5;
      spawnParticles(state.particles, user.x + user.width / 2, user.y + user.height / 2, "#4FACFE", 15, 8);
      break;
    }
    case "heavy-brawler": {
      // Ground Slam — shockwave
      const slammer = user;
      for (const target of state.entities) {
        if (target.id === slammer.id || !target.alive) continue;
        const d = dist(slammer, target);
        if (d < 150) {
          const angle = Math.atan2(
            target.y - slammer.y,
            target.x - slammer.x
          );
          const force = (150 - d) / 150 * 15;
          target.vx += Math.cos(angle) * force;
          target.vy += Math.sin(angle) * force - 5;
          target.hitFlash = 20;
        }
      }
      // Big shockwave particles
      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2;
        state.particles.push({
          x: slammer.x + slammer.width / 2,
          y: slammer.y + slammer.height,
          vx: Math.cos(angle) * 8,
          vy: Math.sin(angle) * 3 - 2,
          life: 25,
          maxLife: 25,
          color: "#FF6B6B",
          size: 6,
        });
      }
      break;
    }
    case "puzzle-genius": {
      // Stun Blast
      for (const target of state.entities) {
        if (target.id === user.id || !target.alive) continue;
        if (dist(user, target) < 160) {
          target.stunTimer = 120; // 2s at 60fps
          target.hitFlash = 20;
          spawnParticles(state.particles, target.x + target.width / 2, target.y + target.height / 2, "#FFD93D", 12, 4);
        }
      }
      // Yellow burst
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        state.particles.push({
          x: user.x + user.width / 2,
          y: user.y + user.height / 2,
          vx: Math.cos(angle) * 6,
          vy: Math.sin(angle) * 6,
          life: 30,
          maxLife: 30,
          color: "#FFD93D",
          size: 5,
        });
      }
      break;
    }
    case "trickster": {
      // Decoy — place a clone
      state.decoys.push({
        x: user.x + user.width / 2,
        y: user.y + user.height / 2,
        life: 180,
        color: user.character.color,
        alpha: 1,
      });
      spawnParticles(state.particles, user.x + user.width / 2, user.y + user.height / 2, "#C77DFF", 12, 5);
      // Trickster jumps in random direction
      user.vx += (Math.random() > 0.5 ? 1 : -1) * user.character.speed * 3;
      user.vy = JUMP_FORCE * 0.8;
      break;
    }
  }
}

function eliminateFromRound(entity: Entity, state: GameState): void {
  entity.alive = false;
  entity.vx = 0;
  entity.vy = 0;
  entity.health = Math.max(0, entity.health - 1);

  // Respawn off-screen for visual
  entity.y = CANVAS_HEIGHT + 100;

  // Explosion particles
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    state.particles.push({
      x: entity.x + entity.width / 2,
      y: CANVAS_HEIGHT - 10,
      vx: Math.cos(angle) * 6,
      vy: Math.sin(angle) * 6 - 4,
      life: 40,
      maxLife: 40,
      color: entity.character.color,
      size: 5 + Math.random() * 4,
    });
  }
}

function endRound(state: GameState): void {
  // Find the winner (last alive or highest score after timer)
  const aliveEntities = state.entities.filter(e => e.alive);
  let winnerId: string | null = null;

  if (aliveEntities.length === 1) {
    winnerId = aliveEntities[0].id;
  } else if (aliveEntities.length === 0) {
    winnerId = null; // draw
  } else {
    // Timer expired — whoever has most health wins; tie goes to player
    let maxHealth = -1;
    for (const e of aliveEntities) {
      if (e.health > maxHealth) {
        maxHealth = e.health;
        winnerId = e.id;
      }
    }
  }

  // Award score
  if (winnerId) {
    const winnerIdx = state.entities.findIndex(e => e.id === winnerId);
    if (winnerIdx >= 0) state.scores[winnerIdx]++;
  }

  state.roundWinnerId = winnerId;
  state.phase = "roundEnd";

  // Check for game winner (best of 3)
  for (let i = 0; i < state.scores.length; i++) {
    if (state.scores[i] >= 2) {
      state.finalWinnerId = state.entities[i].id;
      state.phase = "gameOver";
      return;
    }
  }
}

function initRound(state: GameState): void {
  state.roundTimer = ROUND_TIME;
  state.phase = "playing";
  state.roundWinnerId = null;
  state.particles = [];
  state.decoys = [];

  // Reset entity positions and alive status
  const startPositions = [200, 350, 520, 680];
  for (let i = 0; i < state.entities.length; i++) {
    const e = state.entities[i];
    e.x = startPositions[i % startPositions.length] - e.width / 2;
    e.y = 300;
    e.vx = 0;
    e.vy = 0;
    e.grounded = false;
    e.alive = true;
    e.stunTimer = 0;
    e.attackCooldown = 0;
    e.abilityCooldown = 0;
    e.hitFlash = 0;
    e.aiState = "roam";
    e.aiTimer = 0;
    e.facing = i === 0 ? 1 : -1;
  }
}

function createInitialStars(): GameState["stars"] {
  return Array.from({ length: 80 }, () => ({
    x: Math.random() * CANVAS_WIDTH,
    y: Math.random() * (CANVAS_HEIGHT * 0.7),
    size: 0.5 + Math.random() * 1.5,
    twinkle: Math.random() * Math.PI * 2,
  }));
}

// Pre-generated star data for UI screens (stable across renders)
const TITLE_STARS = Array.from({ length: 60 }, (_, idx) => ({
  id: `ts-${idx}`,
  left: (idx * 7.3 + 3.1) % 100,
  top: (idx * 11.7 + 5.3) % 70,
  w: 1 + (idx % 3) * 0.5,
  opacity: 0.4 + (idx % 5) * 0.12,
  dur: 1.5 + (idx % 6) * 0.5,
  delay: (idx % 10) * 0.3,
}));

const CHARSELECT_STARS = Array.from({ length: 40 }, (_, idx) => ({
  id: `cs-${idx}`,
  left: (idx * 9.1 + 1.7) % 100,
  top: (idx * 13.3 + 2.9) % 100,
  w: 1 + (idx % 2) * 0.5,
  opacity: 0.3 + (idx % 4) * 0.1,
  dur: 2 + (idx % 5) * 0.6,
  delay: (idx % 8) * 0.375,
}));

const GAMEOVER_STARS = Array.from({ length: 50 }, (_, idx) => ({
  id: `go-${idx}`,
  left: (idx * 8.7 + 4.3) % 100,
  top: (idx * 10.9 + 6.1) % 100,
  w: 1 + (idx % 3) * 0.5,
  opacity: 0.3 + (idx % 5) * 0.1,
  dur: 2 + (idx % 5) * 0.6,
  delay: (idx % 9) * 0.333,
}));

// ============================================================
// SCREEN COMPONENTS
// ============================================================

// ============================================================
// HOW TO PLAY MODAL
// ============================================================

function HowToPlayModal({ onClose }: { onClose: () => void }) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sectionHeadingStyle: React.CSSProperties = {
    fontFamily: "'Fredoka One', cursive",
    color: "#FFD93D",
    fontSize: 20,
    marginBottom: 10,
    textShadow: "0 0 12px rgba(255,217,61,0.5)",
    letterSpacing: "0.04em",
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "'Nunito', sans-serif",
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  };

  const valueStyle: React.CSSProperties = {
    fontFamily: "'Nunito', sans-serif",
    color: "#fff",
    fontSize: 14,
    fontWeight: 700,
  };

  const controls: { action: string; keys: string }[] = [
    { action: "Move", keys: "A / D  or  ← →" },
    { action: "Jump", keys: "W / ↑ / Space" },
    { action: "Attack", keys: "E" },
    { action: "Special Ability", keys: "Q" },
  ];

  const characterGuide: { emoji: string; name: string; color: string; ability: string; desc: string }[] = [
    { emoji: "💨", name: "Speed Runner", color: "#4FACFE", ability: "Dash", desc: "Burst forward, phase through opponents" },
    { emoji: "💥", name: "Heavy Brawler", color: "#FF6B6B", ability: "Ground Slam", desc: "Shockwave knocks everyone away" },
    { emoji: "⚡", name: "Puzzle Genius", color: "#FFD93D", ability: "Stun Blast", desc: "Stuns nearby enemies for 2s" },
    { emoji: "🎭", name: "Trickster", color: "#C77DFF", ability: "Decoy", desc: "Leaves a clone to confuse AI" },
  ];

  const tips: { icon: string; text: string }[] = [
    { icon: "⭕", text: "Watch the cooldown ring around your character — that's when Q recharges" },
    { icon: "💀", text: "Don't fall off the platform — you lose a life each time you drop" },
    { icon: "🤖", text: "AI gets more aggressive as the round goes on, stay alert!" },
    { icon: "♥", text: "Hearts (♥♥♥) in the top HUD show each fighter's remaining lives" },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="How to Play"
      className="fixed inset-0 flex items-center justify-center"
      style={{
        background: "rgba(10,7,22,0.82)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        zIndex: 200,
      }}
    >
      {/* Clickable backdrop */}
      <button
        type="button"
        aria-label="Close modal"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          zIndex: 0,
        }}
      />
      <div
        className="relative w-full overflow-y-auto"
        style={{
          maxWidth: 740,
          maxHeight: "90vh",
          margin: "0 16px",
          background: "linear-gradient(160deg, #1a0f35 0%, #0f1535 60%, #12082a 100%)",
          border: "2px solid rgba(199,125,255,0.35)",
          borderRadius: 24,
          boxShadow: "0 0 60px rgba(199,125,255,0.2), 0 30px 80px rgba(0,0,0,0.7)",
          padding: "36px 32px 28px",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "rgba(255,107,107,0.12)",
            border: "1.5px solid rgba(255,107,107,0.4)",
            color: "#FF6B6B",
            borderRadius: 10,
            padding: "5px 14px",
            fontSize: 13,
            fontFamily: "'Nunito', sans-serif",
            fontWeight: 800,
            cursor: "pointer",
            letterSpacing: "0.04em",
            transition: "background 0.15s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,107,107,0.25)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,107,107,0.12)"; }}
          aria-label="Close how to play"
        >
          ✕ CLOSE
        </button>

        {/* Title */}
        <div className="text-center mb-8">
          <h2 style={{
            fontFamily: "'Fredoka One', cursive",
            fontSize: 38,
            color: "#FFD93D",
            textShadow: "0 0 24px rgba(255,217,61,0.7), 3px 3px 0 rgba(0,0,0,0.5)",
            lineHeight: 1.1,
          }}>
            🎯 How to Play
          </h2>
          <p style={{ fontFamily: "'Nunito', sans-serif", color: "rgba(255,255,255,0.4)", fontSize: 13, marginTop: 4 }}>
            Chaos Carnival — Arena Mode
          </p>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(199,125,255,0.4), transparent)", marginBottom: 28 }} />

        {/* Grid layout: left col + right col */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "28px 32px" }}>

          {/* ── Section 1: Objective ── */}
          <div style={{ gridColumn: "1 / -1" }}>
            <h3 style={sectionHeadingStyle}>🏆 Objective</h3>
            <div style={{
              background: "rgba(255,217,61,0.06)",
              border: "1px solid rgba(255,217,61,0.18)",
              borderRadius: 14,
              padding: "14px 18px",
              display: "flex",
              flexDirection: "column" as const,
              gap: 8,
            }}>
              {[
                "3 rounds — first to win 2 rounds wins the Carnival",
                "Knock opponents off the platform edge to eliminate them",
                "Survive the longest or have the most lives when time runs out",
              ].map((line) => (
                <div key={line} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ color: "#FFD93D", fontSize: 16, flexShrink: 0, marginTop: 1 }}>•</span>
                  <span style={{ fontFamily: "'Nunito', sans-serif", color: "rgba(255,255,255,0.82)", fontSize: 14, lineHeight: 1.5 }}>{line}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Section 2: Controls ── */}
          <div>
            <h3 style={sectionHeadingStyle}>🎮 Controls</h3>
            <div style={{
              background: "rgba(79,172,254,0.06)",
              border: "1px solid rgba(79,172,254,0.2)",
              borderRadius: 14,
              overflow: "hidden",
            }}>
              {controls.map((row, i) => (
                <div
                  key={row.action}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 16px",
                    borderBottom: i < controls.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.025)",
                  }}
                >
                  <span style={labelStyle}>{row.action}</span>
                  <span style={{
                    ...valueStyle,
                    color: "#4FACFE",
                    background: "rgba(79,172,254,0.1)",
                    border: "1px solid rgba(79,172,254,0.25)",
                    borderRadius: 7,
                    padding: "3px 10px",
                    fontSize: 13,
                  }}>{row.keys}</span>
                </div>
              ))}
              <div style={{
                padding: "9px 16px",
                background: "rgba(107,255,184,0.05)",
                borderTop: "1px solid rgba(107,255,184,0.15)",
              }}>
                <span style={{ fontFamily: "'Nunito', sans-serif", color: "rgba(107,255,184,0.8)", fontSize: 12, fontWeight: 700 }}>
                  📱 On-screen buttons available for mobile / touch
                </span>
              </div>
            </div>
          </div>

          {/* ── Section 4: Tips ── */}
          <div>
            <h3 style={sectionHeadingStyle}>💡 Tips</h3>
            <div style={{
              background: "rgba(107,255,184,0.05)",
              border: "1px solid rgba(107,255,184,0.2)",
              borderRadius: 14,
              padding: "12px 16px",
              display: "flex",
              flexDirection: "column" as const,
              gap: 10,
            }}>
              {tips.map((tip) => (
                <div key={tip.icon} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{tip.icon}</span>
                  <span style={{ fontFamily: "'Nunito', sans-serif", color: "rgba(255,255,255,0.75)", fontSize: 13, lineHeight: 1.5 }}>{tip.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Section 3: Characters — full width ── */}
          <div style={{ gridColumn: "1 / -1" }}>
            <h3 style={sectionHeadingStyle}>🎭 Characters & Special Abilities</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {characterGuide.map((char) => (
                <div
                  key={char.name}
                  style={{
                    background: `${char.color}0d`,
                    border: `1.5px solid ${char.color}35`,
                    borderRadius: 14,
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  {/* Emoji avatar */}
                  <div style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: `radial-gradient(circle at 35% 35%, ${lightenColor(char.color, 40)}, ${char.color}, ${darkenColor(char.color, 30)})`,
                    boxShadow: `0 0 14px ${char.color}55`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    flexShrink: 0,
                  }}>
                    {char.emoji}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: "'Fredoka One', cursive",
                      color: char.color,
                      fontSize: 15,
                      textShadow: `0 0 8px ${char.color}55`,
                      lineHeight: 1.2,
                    }}>
                      {char.name}
                    </div>
                    <div style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 5,
                      marginTop: 3,
                    }}>
                      <span style={{
                        fontFamily: "'Nunito', sans-serif",
                        fontSize: 11,
                        fontWeight: 800,
                        color: "#FFD93D",
                        background: "rgba(255,217,61,0.12)",
                        border: "1px solid rgba(255,217,61,0.25)",
                        borderRadius: 5,
                        padding: "1px 6px",
                        flexShrink: 0,
                      }}>Q: {char.ability}</span>
                    </div>
                    <div style={{
                      fontFamily: "'Nunito', sans-serif",
                      color: "rgba(255,255,255,0.55)",
                      fontSize: 12,
                      marginTop: 3,
                      lineHeight: 1.4,
                    }}>
                      {char.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Bottom CTA */}
        <div style={{ marginTop: 28, textAlign: "center" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontFamily: "'Fredoka One', cursive",
              background: "linear-gradient(135deg, #C77DFF, #4FACFE)",
              color: "#fff",
              border: "none",
              borderRadius: 16,
              padding: "13px 48px",
              fontSize: 20,
              cursor: "pointer",
              boxShadow: "0 0 24px rgba(199,125,255,0.4), 0 4px 0 rgba(80,30,150,0.5)",
              letterSpacing: "0.04em",
              transition: "transform 0.1s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px) scale(1.03)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "none"; }}
          >
            Got it! Let's Play 🎮
          </button>
        </div>
      </div>
    </div>
  );
}

function StatBar({ value, max = 5, color }: { value: number; max?: number; color: string }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: max }, (_, slot) => {
        const slotId = `slot-${color}-${slot < value ? "filled" : "empty"}-${max - slot}`;
        return (
          <div
            key={slotId}
            className="h-3 w-5 rounded-sm transition-all duration-300"
            style={{
              background: slot < value ? color : "rgba(255,255,255,0.1)",
              boxShadow: slot < value ? `0 0 6px ${color}` : "none",
            }}
          />
        );
      })}
    </div>
  );
}

function TitleScreen({ onPlay }: { onPlay: () => void }) {
  const [showHowToPlay, setShowHowToPlay] = useState(false);

  return (
    <div className="relative w-full h-screen overflow-hidden flex flex-col items-center justify-center"
      style={{ background: "linear-gradient(180deg, #0d0a1e 0%, #1a0a2e 50%, #0f1535 100%)" }}>

      {/* Animated star field */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {TITLE_STARS.map((star) => (
          <div
            key={star.id}
            className="absolute rounded-full"
            style={{
              left: `${star.left}%`,
              top: `${star.top}%`,
              width: `${star.w}px`,
              height: `${star.w}px`,
              background: "white",
              opacity: star.opacity,
              animation: `star-twinkle ${star.dur}s ease-in-out infinite`,
              animationDelay: `${star.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Bunting flags */}
      <div className="absolute top-0 left-0 right-0 flex justify-around pointer-events-none" style={{ height: 60 }}>
        {[
          { id: "b0", color: "#FF6B6B", delay: 0, mt: 0 },
          { id: "b1", color: "#FFD93D", delay: 1, mt: 1 },
          { id: "b2", color: "#4FACFE", delay: 2, mt: 2 },
          { id: "b3", color: "#C77DFF", delay: 3, mt: 3 },
          { id: "b4", color: "#6BFFB8", delay: 4, mt: 4 },
          { id: "b5", color: "#FF9F43", delay: 5, mt: 5 },
          { id: "b6", color: "#FF6B6B", delay: 6, mt: 6 },
          { id: "b7", color: "#FFD93D", delay: 7, mt: 7 },
          { id: "b8", color: "#4FACFE", delay: 8, mt: 8 },
          { id: "b9", color: "#C77DFF", delay: 9, mt: 9 },
          { id: "b10", color: "#6BFFB8", delay: 10, mt: 10 },
          { id: "b11", color: "#FF9F43", delay: 11, mt: 11 },
        ].map(({ id, color, delay, mt }) => (
          <div
            key={id}
            className="animate-flag-wave"
            style={{
              width: 0,
              height: 0,
              borderLeft: "12px solid transparent",
              borderRight: "12px solid transparent",
              borderTop: `24px solid ${color}`,
              animationDelay: `${delay * 0.15}s`,
              marginTop: 8 + Math.sin(mt * 0.8) * 6,
              filter: `drop-shadow(0 0 6px ${color})`,
            }}
          />
        ))}
      </div>

      {/* Hero image */}
      <div className="relative z-10 animate-carnival-entrance mb-2">
        <img
          src="/assets/generated/title-bg.dim_1200x600.jpg"
          alt="Chaos Carnival"
          className="w-full max-w-2xl object-cover rounded-2xl opacity-80"
          style={{ maxHeight: 260, objectPosition: "center top" }}
        />
        <div className="absolute inset-0 rounded-2xl"
          style={{ background: "linear-gradient(to bottom, transparent 50%, rgba(13,10,30,0.95) 100%)" }} />
      </div>

      {/* Title */}
      <div className="relative z-10 text-center animate-carnival-entrance" style={{ animationDelay: "0.1s", opacity: 0, animationFillMode: "forwards" }}>
        <h1
          className="text-7xl md:text-8xl font-display tracking-wide mb-1"
          style={{
            fontFamily: "'Fredoka One', cursive",
            color: "#FFD93D",
            textShadow: "0 0 20px rgba(255,217,61,0.8), 0 0 60px rgba(255,217,61,0.4), 4px 4px 0 rgba(0,0,0,0.5)",
          }}
        >
          CHAOS
        </h1>
        <h2
          className="text-5xl md:text-6xl font-display tracking-widest -mt-2"
          style={{
            fontFamily: "'Fredoka One', cursive",
            color: "#FF6B6B",
            textShadow: "0 0 20px rgba(255,107,107,0.8), 0 0 60px rgba(255,107,107,0.4), 3px 3px 0 rgba(0,0,0,0.5)",
          }}
        >
          CARNIVAL
        </h2>
        <p className="mt-3 text-base font-body"
          style={{ color: "rgba(255,255,255,0.5)", fontFamily: "'Nunito', sans-serif" }}>
          🎪 Arena Chaos • 3 Rounds • Single Player vs AI 🎪
        </p>
      </div>

      {/* Buttons row */}
      <div className="mt-8 z-10 flex flex-col items-center gap-3 animate-bounce-in" style={{ animationDelay: "0.4s", opacity: 0, animationFillMode: "forwards" }}>
        <button
          type="button"
          onClick={onPlay}
          className="btn-carnival px-16 py-5 text-3xl rounded-2xl font-display relative overflow-hidden"
          style={{
            fontFamily: "'Fredoka One', cursive",
            background: "linear-gradient(135deg, #FF6B6B, #FF9F43)",
            color: "#fff",
            boxShadow: "0 0 30px rgba(255,107,107,0.6), 0 6px 0 rgba(150,30,30,0.6)",
            border: "none",
            cursor: "pointer",
          }}
        >
          🎮 PLAY NOW
        </button>

        {/* How to Play secondary button */}
        <button
          type="button"
          onClick={() => setShowHowToPlay(true)}
          className="btn-carnival px-10 py-3 text-lg rounded-xl font-display"
          style={{
            fontFamily: "'Fredoka One', cursive",
            background: "rgba(199,125,255,0.12)",
            color: "#C77DFF",
            border: "2px solid rgba(199,125,255,0.4)",
            cursor: "pointer",
            letterSpacing: "0.04em",
            boxShadow: "0 0 16px rgba(199,125,255,0.2)",
            transition: "background 0.2s, box-shadow 0.2s",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(199,125,255,0.22)";
            (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 24px rgba(199,125,255,0.4)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(199,125,255,0.12)";
            (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 16px rgba(199,125,255,0.2)";
          }}
        >
          ? HOW TO PLAY
        </button>
      </div>

      {/* How To Play Modal */}
      {showHowToPlay && <HowToPlayModal onClose={() => setShowHowToPlay(false)} />}

      {/* Footer */}
      <p className="absolute bottom-4 text-xs" style={{ color: "rgba(255,255,255,0.25)", fontFamily: "'Nunito', sans-serif" }}>
        © 2026. Built with ❤️ using{" "}
        <a href="https://caffeine.ai" target="_blank" rel="noopener noreferrer"
          style={{ color: "rgba(199,125,255,0.6)" }}>caffeine.ai</a>
      </p>
    </div>
  );
}

function CharacterPickStep({
  playerIndex,
  numPlayers,
  takenIds,
  onPick,
  onBack,
}: {
  playerIndex: number;
  numPlayers: number;
  takenIds: Set<string>;
  onPick: (char: Character) => void;
  onBack: () => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const pColor = PLAYER_COLORS[playerIndex] ?? "#FFD93D";
  const isLast = playerIndex === numPlayers;

  const handleSelect = (char: Character) => {
    if (takenIds.has(char.id)) return;
    setSelected(char.id);
    setTimeout(() => onPick(char), 280);
  };

  return (
    <div className="relative z-10 w-full max-w-5xl">
      {/* Header */}
      <div className="text-center mb-5">
        <div style={{
          display: "inline-block",
          background: `${pColor}22`,
          border: `2px solid ${pColor}66`,
          borderRadius: 12,
          padding: "4px 18px",
          marginBottom: 8,
        }}>
          <span style={{ fontFamily: "'Fredoka One', cursive", color: pColor, fontSize: 18 }}>
            Player {playerIndex}
          </span>
        </div>
        <h2
          className="text-5xl mb-1"
          style={{
            fontFamily: "'Fredoka One', cursive",
            color: pColor,
            textShadow: `0 0 20px ${pColor}88, 3px 3px 0 rgba(0,0,0,0.5)`,
          }}
        >
          Choose Your Fighter
        </h2>
        <p style={{ color: "rgba(255,255,255,0.45)", fontFamily: "'Nunito', sans-serif", fontSize: 14 }}>
          {isLast ? "Last pick — then the game starts!" : `${numPlayers - playerIndex} more player${numPlayers - playerIndex > 1 ? "s" : ""} after you`}
        </p>
      </div>

      {/* Character cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {CHARACTERS.map((char) => {
          const isTaken = takenIds.has(char.id);
          const isHov = hovered === char.id && !isTaken;
          const isSel = selected === char.id;
          return (
            <button
              type="button"
              key={char.id}
              disabled={isTaken}
              onMouseEnter={() => !isTaken && setHovered(char.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => handleSelect(char)}
              className="rounded-2xl p-4 text-left transition-all duration-200"
              style={{
                cursor: isTaken ? "not-allowed" : "pointer",
                opacity: isTaken ? 0.35 : 1,
                background: isHov || isSel
                  ? `linear-gradient(135deg, ${char.color}22, ${char.color}11)`
                  : "rgba(255,255,255,0.04)",
                border: `2px solid ${isHov || isSel ? char.color : "rgba(255,255,255,0.08)"}`,
                boxShadow: isHov || isSel ? `0 0 24px ${char.color}44, 0 8px 24px rgba(0,0,0,0.4)` : "0 4px 16px rgba(0,0,0,0.3)",
                transform: isHov ? "translateY(-4px) scale(1.02)" : isSel ? "scale(0.97)" : "none",
              }}
            >
              <div
                className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center text-3xl"
                style={{
                  background: `radial-gradient(circle at 35% 35%, ${lightenColor(char.color, 40)}, ${char.color}, ${darkenColor(char.color, 30)})`,
                  boxShadow: `0 0 ${isHov ? 24 : 12}px ${char.color}66`,
                  transition: "box-shadow 0.2s",
                }}
              >
                {char.emoji}
              </div>
              <div
                className="text-center font-display text-lg mb-2"
                style={{ fontFamily: "'Fredoka One', cursive", color: char.color, textShadow: `0 0 10px ${char.color}66` }}
              >
                {char.name}
                {isTaken && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block" }}>TAKEN</span>}
              </div>
              <div className="space-y-2 mb-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)", fontFamily: "'Nunito'" }}>Speed</span>
                  <StatBar value={char.statsDisplay.speed} color={char.color} />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)", fontFamily: "'Nunito'" }}>Power</span>
                  <StatBar value={char.statsDisplay.strength} color={char.color} />
                </div>
              </div>
              <div className="rounded-lg p-2" style={{ background: `${char.color}15`, border: `1px solid ${char.color}30` }}>
                <div className="text-xs font-bold mb-1" style={{ color: char.color, fontFamily: "'Nunito'" }}>
                  {playerIndex === 1 ? "Q" : playerIndex === 2 ? "G" : "P"}: {char.abilityName}
                </div>
                <div className="text-xs leading-tight" style={{ color: "rgba(255,255,255,0.5)", fontFamily: "'Nunito'" }}>
                  {char.abilityDesc}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="text-center mt-5">
        <button
          type="button"
          onClick={onBack}
          className="btn-carnival px-6 py-2 rounded-xl text-sm"
          style={{
            fontFamily: "'Nunito', sans-serif",
            background: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.6)",
            border: "1px solid rgba(255,255,255,0.15)",
            cursor: "pointer",
          }}
        >
          ← Back
        </button>
      </div>
    </div>
  );
}

function CharacterSelectScreen({
  onSelect,
  onBack,
}: {
  onSelect: (chars: Character[]) => void;
  onBack: () => void;
}) {
  // Step 0 = choose player count, step N = player N picks character
  const [step, setStep] = useState<"playerCount" | number>("playerCount");
  const [numPlayers, setNumPlayers] = useState(1);
  const [picks, setPicks] = useState<Character[]>([]);

  const takenIds = new Set(picks.map(c => c.id));

  const handleCountSelect = (n: number) => {
    setNumPlayers(n);
    setStep(1);
  };

  const handlePick = (char: Character) => {
    const newPicks = [...picks, char];
    if (newPicks.length >= numPlayers) {
      onSelect(newPicks);
    } else {
      setPicks(newPicks);
      setStep(newPicks.length + 1);
    }
  };

  const handleStepBack = () => {
    if (step === 1) {
      setPicks([]);
      setStep("playerCount");
    } else if (typeof step === "number" && step > 1) {
      setPicks(picks.slice(0, -1));
      setStep((step as number) - 1);
    }
  };

  const playerCountBtnStyle = (n: number, active: boolean): React.CSSProperties => ({
    fontFamily: "'Fredoka One', cursive",
    fontSize: 20,
    padding: "16px 36px",
    borderRadius: 16,
    border: `2px solid ${active ? "#FFD93D" : "rgba(255,255,255,0.2)"}`,
    background: active ? "rgba(255,217,61,0.15)" : "rgba(255,255,255,0.05)",
    color: active ? "#FFD93D" : "rgba(255,255,255,0.8)",
    cursor: "pointer",
    transition: "all 0.15s",
    boxShadow: active ? "0 0 20px rgba(255,217,61,0.3)" : "none",
  });

  return (
    <div
      className="w-full h-screen overflow-hidden flex flex-col items-center justify-center px-4"
      style={{ background: "linear-gradient(180deg, #0d0a1e 0%, #1a0a2e 50%, #0f1535 100%)" }}
    >
      {/* Stars bg */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {CHARSELECT_STARS.map((star) => (
          <div key={star.id} className="absolute rounded-full"
            style={{
              left: `${star.left}%`, top: `${star.top}%`,
              width: `${star.w}px`, height: `${star.w}px`,
              background: "white", opacity: star.opacity,
              animation: `star-twinkle ${star.dur}s ease-in-out infinite`,
              animationDelay: `${star.delay}s`,
            }}
          />
        ))}
      </div>

      {step === "playerCount" ? (
        <div className="relative z-10 w-full max-w-xl text-center">
          <h2 style={{ fontFamily: "'Fredoka One', cursive", fontSize: 48, color: "#FFD93D", textShadow: "0 0 20px rgba(255,217,61,0.6), 3px 3px 0 rgba(0,0,0,0.5)", marginBottom: 8 }}>
            How Many Players?
          </h2>
          <p style={{ color: "rgba(255,255,255,0.45)", fontFamily: "'Nunito', sans-serif", fontSize: 14, marginBottom: 36 }}>
            Share one keyboard — AI fills remaining slots
          </p>

          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginBottom: 40 }}>
            {[1, 2, 3].map(n => (
              <button
                key={n}
                type="button"
                style={playerCountBtnStyle(n, numPlayers === n)}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-3px)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "none"; }}
                onClick={() => handleCountSelect(n)}
              >
                {n === 1 ? "1 Player" : `${n} Players`}
              </button>
            ))}
          </div>

          {/* Key binding preview */}
          <div style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 16,
            padding: "16px 24px",
            textAlign: "left",
            marginBottom: 28,
          }}>
            {[
              { p: 1, color: PLAYER_COLORS[1], label: "P1", keys: "← → ↑/Space — Move/Jump    E — Attack    Q — Special" },
              { p: 2, color: PLAYER_COLORS[2], label: "P2", keys: "A D W — Move/Jump    F — Attack    G — Special" },
              { p: 3, color: PLAYER_COLORS[3], label: "P3", keys: "J L I — Move/Jump    O — Attack    P — Special" },
            ].map(({ p, color, label, keys }) => (
              <div key={p} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: p < 3 ? 10 : 0, opacity: numPlayers >= p ? 1 : 0.3, transition: "opacity 0.2s" }}>
                <span style={{ fontFamily: "'Fredoka One', cursive", color, fontSize: 15, minWidth: 28 }}>{label}</span>
                <span style={{ fontFamily: "'Nunito', sans-serif", color: "rgba(255,255,255,0.6)", fontSize: 13 }}>{keys}</span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={onBack}
            style={{
              fontFamily: "'Nunito', sans-serif",
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.6)",
              border: "1px solid rgba(255,255,255,0.15)",
              cursor: "pointer",
              borderRadius: 12,
              padding: "8px 20px",
              fontSize: 14,
            }}
          >
            ← Back to Title
          </button>
        </div>
      ) : (
        <CharacterPickStep
          playerIndex={step as number}
          numPlayers={numPlayers}
          takenIds={takenIds}
          onPick={handlePick}
          onBack={handleStepBack}
        />
      )}
    </div>
  );
}

interface RoundEndOverlayProps {
  entities: Entity[];
  scores: number[];
  round: number;
  roundWinnerId: string | null;
  onContinue: () => void;
}

function RoundEndOverlay({ entities, scores, round, roundWinnerId, onContinue }: RoundEndOverlayProps) {
  const winner = entities.find(e => e.id === roundWinnerId);
  const isPlayerWin = winner?.isPlayer ?? false;

  useEffect(() => {
    const timeout = setTimeout(onContinue, 3000);
    return () => clearTimeout(timeout);
  }, [onContinue]);

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center"
      style={{ background: "rgba(13,10,30,0.85)", backdropFilter: "blur(4px)", zIndex: 50 }}
    >
      <div className="animate-bounce-in text-center">
        <div
          className="text-7xl mb-4"
          style={{ animation: "float 2s ease-in-out infinite" }}
        >
          {winner ? winner.character.emoji : "🤝"}
        </div>

        <h2
          className="text-5xl mb-2"
          style={{
            fontFamily: "'Fredoka One', cursive",
            color: isPlayerWin ? "#FFD93D" : winner ? winner.character.color : "#fff",
            textShadow: `0 0 30px ${isPlayerWin ? "rgba(255,217,61,0.8)" : winner ? `${winner.character.color}88` : "rgba(255,255,255,0.5)"}`,
          }}
        >
          {winner
            ? (isPlayerWin ? "🎉 You Win!" : `${winner.character.name} Wins!`)
            : "Draw!"}
        </h2>

        <p style={{ color: "rgba(255,255,255,0.5)", fontFamily: "'Nunito'", fontSize: 16 }}>
          Round {round} of 3
        </p>

        {/* Scores */}
        <div className="flex gap-8 justify-center mt-4">
          {entities.map((e, i) => (
            <div key={e.id} className="text-center">
              <div
                className="text-3xl font-display"
                style={{
                  fontFamily: "'Fredoka One', cursive",
                  color: e.character.color,
                  textShadow: `0 0 12px ${e.character.color}66`,
                }}
              >
                {scores[i]}
              </div>
              <div className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)", fontFamily: "'Nunito'" }}>
                {e.playerIndex > 0 ? `P${e.playerIndex}` : e.character.name.split(" ")[0]}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-sm" style={{ color: "rgba(255,255,255,0.3)", fontFamily: "'Nunito'" }}>
          Next round in 3 seconds...
        </p>
      </div>
    </div>
  );
}

interface GameOverScreenProps {
  entities: Entity[];
  scores: number[];
  finalWinnerId: string | null;
  onPlayAgain: () => void;
  onChangeChar: () => void;
}

function GameOverScreen({ entities, scores, finalWinnerId, onPlayAgain, onChangeChar }: GameOverScreenProps) {
  const winner = entities.find(e => e.id === finalWinnerId);
  const isPlayerWin = winner?.isPlayer ?? false;

  return (
    <div
      className="w-full h-screen flex flex-col items-center justify-center"
      style={{ background: "linear-gradient(180deg, #0d0a1e 0%, #1a0a2e 50%, #0f1535 100%)" }}
    >
      {/* Stars */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {GAMEOVER_STARS.map((star) => (
          <div key={star.id} className="absolute rounded-full"
            style={{
              left: `${star.left}%`, top: `${star.top}%`,
              width: `${star.w}px`, height: `${star.w}px`,
              background: "white", opacity: star.opacity,
              animation: `star-twinkle ${star.dur}s ease-in-out infinite`,
              animationDelay: `${star.delay}s`,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 text-center animate-carnival-entrance">
        {/* Trophy / character emoji */}
        <div
          className="text-8xl mb-4 block"
          style={{ animation: "float 2.5s ease-in-out infinite" }}
        >
          {isPlayerWin ? "🏆" : winner ? winner.character.emoji : "🎭"}
        </div>

        {/* Win/Lose headline */}
        <h1
          className="text-6xl mb-3"
          style={{
            fontFamily: "'Fredoka One', cursive",
            color: isPlayerWin ? "#FFD93D" : "#FF6B6B",
            textShadow: `0 0 30px ${isPlayerWin ? "rgba(255,217,61,0.8)" : "rgba(255,107,107,0.8)"}, 4px 4px 0 rgba(0,0,0,0.5)`,
          }}
        >
          {isPlayerWin ? "CHAMPION!" : "GAME OVER"}
        </h1>

        {/* Winner name */}
        {winner && (
          <p
            className="text-xl mb-6"
            style={{
              color: winner.character.color,
              fontFamily: "'Nunito', sans-serif",
              fontWeight: 700,
              textShadow: `0 0 12px ${winner.character.color}66`,
            }}
          >
            {isPlayerWin ? (winner?.playerIndex === 1 ? "P1 dominated the Carnival!" : `P${winner?.playerIndex} wins the Carnival!`) : `${winner.character.name} wins the Carnival!`}
          </p>
        )}

        {/* Final scores */}
        <div
          className="flex gap-6 justify-center mb-8 p-5 rounded-2xl"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {entities.map((e, i) => (
            <div key={e.id} className="text-center px-4">
              <div
                className="w-14 h-14 rounded-full mx-auto mb-2 flex items-center justify-center text-2xl"
                style={{
                  background: `radial-gradient(circle at 35% 35%, ${lightenColor(e.character.color, 40)}, ${e.character.color})`,
                  boxShadow: `0 0 16px ${e.character.color}66`,
                }}
              >
                {e.character.emoji}
              </div>
              <div
                className="text-4xl font-display"
                style={{
                  fontFamily: "'Fredoka One', cursive",
                  color: e.character.color,
                  textShadow: `0 0 12px ${e.character.color}66`,
                }}
              >
                {scores[i]}
              </div>
              <div className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)", fontFamily: "'Nunito'" }}>
                {e.playerIndex > 0 ? `P${e.playerIndex}` : e.character.name.split(" ")[0]}
              </div>
              {e.id === finalWinnerId && (
                <div className="mt-1 text-xs font-bold" style={{ color: "#FFD93D" }}>👑 WINNER</div>
              )}
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex gap-4 justify-center">
          <button
            type="button"
            onClick={onPlayAgain}
            className="btn-carnival px-10 py-4 text-xl rounded-2xl"
            style={{
              fontFamily: "'Fredoka One', cursive",
              background: "linear-gradient(135deg, #FF6B6B, #FF9F43)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 0 20px rgba(255,107,107,0.5), 0 4px 0 rgba(150,30,30,0.5)",
            }}
          >
            🔄 Play Again
          </button>
          <button
            type="button"
            onClick={onChangeChar}
            className="btn-carnival px-10 py-4 text-xl rounded-2xl"
            style={{
              fontFamily: "'Fredoka One', cursive",
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.8)",
              border: "2px solid rgba(255,255,255,0.2)",
              cursor: "pointer",
            }}
          >
            🎭 Change Fighter
          </button>
        </div>
      </div>

      {/* Footer */}
      <p className="absolute bottom-4 text-xs z-10" style={{ color: "rgba(255,255,255,0.2)", fontFamily: "'Nunito', sans-serif" }}>
        © 2026. Built with ❤️ using{" "}
        <a href="https://caffeine.ai" target="_blank" rel="noopener noreferrer"
          style={{ color: "rgba(199,125,255,0.5)" }}>caffeine.ai</a>
      </p>
    </div>
  );
}

// ============================================================
// MAIN GAME CANVAS COMPONENT
// ============================================================

interface GameCanvasProps {
  playerCharacters: Character[];
  onRoundEnd: (state: GameState) => void;
  onGameOver: (state: GameState) => void;
  initialGameState?: GameState | null;
}

function GameCanvas({ playerCharacters, onRoundEnd, onGameOver, initialGameState }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const roundEndCallbackRef = useRef(onRoundEnd);
  const gameOverCallbackRef = useRef(onGameOver);
  roundEndCallbackRef.current = onRoundEnd;
  gameOverCallbackRef.current = onGameOver;

  const initGame = useCallback(() => {
    // Build entities: human players first, then AI for remaining slots
    const chosenIds = new Set(playerCharacters.map(c => c.id));
    const aiCharacters = CHARACTERS.filter(c => !chosenIds.has(c.id));
    const shuffledAI = [...aiCharacters].sort(() => Math.random() - 0.5);

    const entities: Entity[] = [];

    // Human players
    playerCharacters.forEach((char, idx) => {
      entities.push(createEntity(`player${idx + 1}`, 0, char, true, idx + 1));
    });

    // AI opponents — always at least 1, total fighters = max(numPlayers+1, 3)
    const totalFighters = Math.max(playerCharacters.length + 1, 3);
    const aiCount = totalFighters - playerCharacters.length;
    for (let i = 0; i < aiCount && i < shuffledAI.length; i++) {
      entities.push(createEntity(`ai${i + 1}`, 0, shuffledAI[i], false, 0));
    }

    const scores = new Array(entities.length).fill(0);

    const state: GameState = {
      entities,
      platforms: PLATFORMS,
      particles: [],
      decoys: [],
      round: 1,
      roundTimer: ROUND_TIME,
      scores,
      phase: "playing",
      roundWinnerId: null,
      finalWinnerId: null,
      keys: {},
      lastTime: 0,
      frameCount: 0,
      stars: createInitialStars(),
      buntingFlags: [],
    };

    // Position entities on main platform
    const mainPlat = PLATFORMS[0];
    const positions = [200, 350, 520, 680];
    entities.forEach((e, i) => {
      e.x = positions[i % positions.length] - e.width / 2;
      e.y = mainPlat.y - e.height;
    });

    gameStateRef.current = state;
  }, [playerCharacters]);

  // Restore from existing state if provided
  useEffect(() => {
    if (initialGameState) {
      gameStateRef.current = initialGameState;
    } else {
      initGame();
    }
  }, [initGame, initialGameState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Key handlers
    const onKeyDown = (e: KeyboardEvent) => {
      const keysToPrevent = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "e", "E", "q", "Q"];
      if (keysToPrevent.includes(e.key)) e.preventDefault();
      if (gameStateRef.current) {
        gameStateRef.current.keys[e.key] = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (gameStateRef.current) {
        gameStateRef.current.keys[e.key] = false;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.focus();

    let prevPhase: string = "playing";

    const gameLoop = (timestamp: number) => {
      if (!gameStateRef.current) return;
      const state = gameStateRef.current;

      const delta = lastTimeRef.current === 0 ? 16.67 : timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      // Draw
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      drawBackground(ctx, state.stars, state.frameCount);
      drawBuntingFlags(ctx, state.buntingFlags, state.frameCount);
      drawPlatforms(ctx, state.platforms);
      drawDecoys(ctx, state.decoys);

      for (const entity of state.entities) {
        drawEntity(ctx, entity, state.frameCount);
      }

      drawParticles(ctx, state.particles);
      drawHUD(ctx, state.entities, state.scores, state.round, state.roundTimer);

      // Update
      if (state.phase === "playing") {
        updateGame(state, delta);
      }

      // Phase change detection
      if (state.phase !== prevPhase) {
        prevPhase = state.phase;
        if (state.phase === "roundEnd") {
          roundEndCallbackRef.current(state);
        } else if (state.phase === "gameOver") {
          gameOverCallbackRef.current(state);
        }
      }

      animFrameRef.current = requestAnimationFrame(gameLoop);
    };

    animFrameRef.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Helper: press / release a virtual key into gameStateRef.current.keys
  const pressKey = useCallback((key: string) => {
    if (gameStateRef.current) gameStateRef.current.keys[key] = true;
  }, []);
  const releaseKey = useCallback((key: string) => {
    if (gameStateRef.current) gameStateRef.current.keys[key] = false;
  }, []);

  // Build pointer-event props for a given virtual key
  const virtualBtn = (key: string) => ({
    onPointerDown: (e: React.PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); pressKey(key); },
    onPointerUp: () => releaseKey(key),
    onPointerLeave: () => releaseKey(key),
  });

  const btnBase: React.CSSProperties = {
    background: "rgba(0,0,0,0.6)",
    border: "2px solid rgba(199,125,255,0.4)",
    color: "#fff",
    borderRadius: 12,
    minWidth: 56,
    minHeight: 56,
    fontSize: 22,
    fontFamily: "'Fredoka One', cursive",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    userSelect: "none",
    WebkitUserSelect: "none",
    touchAction: "none",
    transition: "box-shadow 0.1s, transform 0.1s",
  };

  return (
    <div className="game-screen" style={{ background: "#0d0a1e", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        tabIndex={0}
        className="game-canvas-wrapper outline-none rounded-xl"
        style={{
          maxWidth: "100vw",
          maxHeight: "calc(100vh - 130px)",
          aspectRatio: `${CANVAS_WIDTH}/${CANVAS_HEIGHT}`,
          border: "2px solid rgba(199,125,255,0.2)",
          boxShadow: "0 0 40px rgba(199,125,255,0.15), 0 20px 60px rgba(0,0,0,0.6)",
        }}
      />

      {/* On-screen controls */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
          maxWidth: CANVAS_WIDTH,
          padding: "6px 16px 4px",
          boxSizing: "border-box",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <div style={{ fontFamily: "'Nunito', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.35)", textAlign: "center" }}>
          P2: A/D W — F attack — G special &nbsp;|&nbsp; P3: J/L I — O attack — P special
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: 12 }}>
        {/* Movement buttons — left side */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            {...virtualBtn("ArrowLeft")}
            style={{
              ...btnBase,
              boxShadow: "0 0 10px rgba(79,172,254,0.5)",
              border: "2px solid rgba(79,172,254,0.5)",
            }}
            aria-label="Move Left"
          >
            ◀
          </button>
          <button
            {...virtualBtn("ArrowRight")}
            style={{
              ...btnBase,
              boxShadow: "0 0 10px rgba(79,172,254,0.5)",
              border: "2px solid rgba(79,172,254,0.5)",
            }}
            aria-label="Move Right"
          >
            ▶
          </button>
        </div>

        {/* Action buttons — right side */}
        <div style={{ display: "flex", gap: 10 }}>
          {/* Jump */}
          <button
            {...virtualBtn(" ")}
            style={{
              ...btnBase,
              minWidth: 64,
              fontSize: 13,
              fontFamily: "'Nunito', sans-serif",
              fontWeight: 800,
              boxShadow: "0 0 10px rgba(107,255,184,0.5)",
              border: "2px solid rgba(107,255,184,0.5)",
              color: "#6BFFB8",
            }}
            aria-label="Jump"
          >
            JUMP
          </button>

          {/* Attack */}
          <button
            {...virtualBtn("e")}
            style={{
              ...btnBase,
              boxShadow: "0 0 10px rgba(255,107,107,0.5)",
              border: "2px solid rgba(255,107,107,0.5)",
              color: "#FF6B6B",
            }}
            aria-label="Attack"
          >
            E
          </button>

          {/* Special */}
          <button
            {...virtualBtn("q")}
            style={{
              ...btnBase,
              boxShadow: "0 0 10px rgba(199,125,255,0.5)",
              border: "2px solid rgba(199,125,255,0.5)",
              color: "#C77DFF",
            }}
            aria-label="Special"
          >
            Q
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// APP ROOT
// ============================================================

export default function App() {
  const [screen, setScreen] = useState<Screen>("title");
  const [playerCharacters, setPlayerCharacters] = useState<Character[]>([]);
  const [gameStateSnapshot, setGameStateSnapshot] = useState<GameState | null>(null);
  const [roundEndData, setRoundEndData] = useState<{
    entities: Entity[];
    scores: number[];
    round: number;
    roundWinnerId: string | null;
  } | null>(null);
  const [gameOverData, setGameOverData] = useState<{
    entities: Entity[];
    scores: number[];
    finalWinnerId: string | null;
  } | null>(null);

  const [showRoundEnd, setShowRoundEnd] = useState(false);

  const handleRoundEnd = useCallback((state: GameState) => {
    setRoundEndData({
      entities: state.entities,
      scores: [...state.scores],
      round: state.round,
      roundWinnerId: state.roundWinnerId,
    });
    setGameStateSnapshot(JSON.parse(JSON.stringify(state)));
    setShowRoundEnd(true);
  }, []);

  const handleGameOver = useCallback((state: GameState) => {
    setGameOverData({
      entities: state.entities,
      scores: [...state.scores],
      finalWinnerId: state.finalWinnerId,
    });
    setScreen("gameOver");
  }, []);

  const handleContinueRound = useCallback(() => {
    setShowRoundEnd(false);
    if (gameStateSnapshot) {
      const nextState: GameState = {
        ...gameStateSnapshot,
        round: gameStateSnapshot.round + 1,
        phase: "playing",
      };
      initRound(nextState);
      setGameStateSnapshot(nextState);
    }
  }, [gameStateSnapshot]);

  const handlePlayAgain = useCallback(() => {
    setGameStateSnapshot(null);
    setShowRoundEnd(false);
    setRoundEndData(null);
    setGameOverData(null);
    setScreen("game");
  }, []);

  const handleChangeChar = useCallback(() => {
    setGameStateSnapshot(null);
    setShowRoundEnd(false);
    setRoundEndData(null);
    setGameOverData(null);
    setPlayerCharacters([]);
    setScreen("characterSelect");
  }, []);

  const handleExitToTitle = useCallback(() => {
    setGameStateSnapshot(null);
    setShowRoundEnd(false);
    setRoundEndData(null);
    setGameOverData(null);
    setPlayerCharacters([]);
    setScreen("title");
  }, []);

  if (screen === "title") {
    return <TitleScreen onPlay={() => setScreen("characterSelect")} />;
  }

  if (screen === "characterSelect") {
    return (
      <CharacterSelectScreen
        onSelect={(chars) => {
          setPlayerCharacters(chars);
          setGameStateSnapshot(null);
          setScreen("game");
        }}
        onBack={() => setScreen("title")}
      />
    );
  }

  if (screen === "gameOver" && gameOverData) {
    const displayEntities = gameOverData.entities;
    return (
      <GameOverScreen
        entities={displayEntities}
        scores={gameOverData.scores}
        finalWinnerId={gameOverData.finalWinnerId}
        onPlayAgain={handlePlayAgain}
        onChangeChar={handleChangeChar}
      />
    );
  }

  if (screen === "game" && playerCharacters.length > 0) {
    return (
      <div className="relative w-full h-screen overflow-hidden" style={{ background: "#0d0a1e" }}>
        {/* Exit button */}
        <button
          onClick={handleExitToTitle}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 100,
            background: "rgba(0,0,0,0.65)",
            border: "2px solid rgba(255,107,107,0.5)",
            color: "#FF6B6B",
            borderRadius: 10,
            padding: "6px 14px",
            fontSize: 13,
            fontFamily: "'Nunito', sans-serif",
            fontWeight: 800,
            cursor: "pointer",
            boxShadow: "0 0 10px rgba(255,107,107,0.3)",
            letterSpacing: "0.05em",
          }}
          type="button"
          aria-label="Exit to title"
        >
          ✕ EXIT
        </button>

        <GameCanvas
          key={gameStateSnapshot ? "resumed-" + gameStateSnapshot.round : "new-game"}
          playerCharacters={playerCharacters}
          onRoundEnd={handleRoundEnd}
          onGameOver={handleGameOver}
          initialGameState={gameStateSnapshot}
        />

        {showRoundEnd && roundEndData && (
          <RoundEndOverlay
            entities={roundEndData.entities}
            scores={roundEndData.scores}
            round={roundEndData.round}
            roundWinnerId={roundEndData.roundWinnerId}
            onContinue={handleContinueRound}
          />
        )}
      </div>
    );
  }

  // Fallback
  return <TitleScreen onPlay={() => setScreen("characterSelect")} />;
}
