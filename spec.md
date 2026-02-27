# Chaos Carnival

## Current State
Single-player vs AI game. One human player (WASD / Arrow keys) fights 2 AI opponents in Arena Chaos mode. Character select screen lets the player pick 1 of 4 characters; AI fills the remaining slots. 3-round best-of-3 format with a round-end overlay and game-over screen.

## Requested Changes (Diff)

### Add
- **Player count selector** on the character select screen: 1, 2, or 3 human players. Default is 1.
- **Multi-player character assignment**: each human player picks their own character (sequential pick screens or simultaneous card row). AI fills remaining spots so total fighters is always 3-4.
- **Second and third player input mappings**:
  - Player 2: W/A/S/D (move/jump), F (attack), G (special)
  - Player 3: I/J/K/L (move/jump), O (attack), P (special)
- **HUD labels**: replace "YOU" with "P1", "P2", "P3" for human players.
- **On-screen virtual buttons updated**: label them P1 controls; optionally note P2/P3 use keyboard only (no on-screen buttons needed for them since it's local co-op on shared keyboard).

### Modify
- `CharacterSelectScreen`: add player count selector (1/2/3) before character pick. When >1 human: show a sequential pick flow ("P1 choose", "P2 choose", etc.) or simultaneous grid with colored selection highlights.
- `GameCanvas` / `initGame`: accept array of player characters (up to 3) and create human-controlled entities for each; remaining slots are AI.
- `updateGame` / player input section: loop through all human entities and apply their respective key bindings.
- `drawHUD` / `drawEntity`: use "P1"/"P2"/"P3" labels instead of "YOU".
- `PLAYER_INDEX` constant: remove (no longer a single index; use `isPlayer: true` on multiple entities).
- `RoundEndOverlay` / `GameOverScreen`: show all player labels correctly.
- `createEntity`: accept a `playerIndex` (0 = not player, 1/2/3 for human players) so label and controls can be derived.

### Remove
- Hardcoded `PLAYER_INDEX = 0` assumption throughout the input handling.

## Implementation Plan
1. Add `playerIndex: number` field to `Entity` (0 = AI, 1/2/3 = human).
2. Define per-player key bindings as a map keyed by playerIndex.
3. Update `CharacterSelectScreen` with player count selector and sequential character pick.
4. Pass `playerCharacters: Character[]` (array) into `GameCanvas`.
5. Update `initGame` to create human entities for each chosen character.
6. Update input loop to handle all human entities by their playerIndex.
7. Update HUD labels and name tags.
8. Update `App` state to hold `playerCharacters[]` and `numPlayers`.

## UX Notes
- Sequential pick flow: "Player 1, choose your fighter" → "Player 2, choose your fighter" → game starts. Each player's card highlights in their player color.
- Player colors for UI badges: P1 = yellow, P2 = cyan, P3 = green.
- Keep on-screen virtual buttons; they map to P1 controls only. Note in HUD that P2/P3 use keyboard.
