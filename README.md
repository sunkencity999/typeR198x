# Type-R 198X

![Type-R 198X Screenshot](./assets/screenshot.png)

Type-R 198X is a neon-drenched typing shmup created by **Christopher Bradford**. It mashes classic R-Type inspirations with a word-zapping combat system: type to lock on, finish the word to vaporize your target, and survive ten increasingly chaotic stages. Play the latest web build at **[https://typer198x.com](https://typer198x.com)** or run the offline bundle in this repo.

## Game Overview

- **Genre:** Single-player typing shooter with roguelite scoring hooks
- **Setting:** Retro-future space lane filled with neon bosses and word-spewing minions
- **Progression:** 10 handcrafted stages, each ending in a multi-phrase boss duel
- **Ships:** Choose from four unlockable ships (Coconut, Little Dark One, Sofrito, HoneyBee), each reflected visually in-game
- **Power System:** Spread, Pierce, Rapid, Shield, and Multiplier pickups stack for brief bursts of bullet mayhem

## How to Play

1. **Enter your pilot name** and pick a ship on the main menu.
2. **Start a run** – the game locks the keyboard to pure typing focus; Esc opens the pause/options overlay.
3. **Type the first letter** of an enemy or powerup to lock on, then finish the word to destroy or collect it.
4. **Maintain combos** to raise your score multiplier and keep bosses from overwhelming you.
5. **Beat the boss** at the end of each stage to advance. Defeating Stage 10 triggers the victory screen.

### Controls

| Action | Input |
| --- | --- |
| Type / Fire | Any letter or space (focus on the canvas) |
| Pause / Menu | `Esc` or click **Pause** |
| Resume | Esc or **Resume** button in pause overlay |
| Restart Stage | Pause → **Restart Level** |
| Stop to Menu | **Stop** button or pause overlay option |
| Toggle Audio | **Mute** button |
| CRT Overlay | **CRT** button |

> Letters are never treated as shortcuts during gameplay, so Bluetooth and hardware keyboards work without losing focus.

## Running Locally

Type-R 198X is packaged as a static web app. The easiest way to launch is via the included shell script.

### Option 1 – macOS Launcher

```bash
./launch-game.command
```

This spins up a Python HTTP server on `http://localhost:8000` and opens the game automatically.

### Option 2 – Manual Server (any OS)

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/index.html` in your browser. (ES modules cannot be loaded from `file://`, so HTTP is required.)

## Save & Tech Notes

- Save data (pilot name, progress, stats, settings) is stored in `localStorage` under `typesmup198x.save.v1`.
- Audio uses the Web Audio API – no large audio assets are bundled.
- The codebase is vanilla HTML/CSS/JS with ES modules; deploy to any static host (Netlify, GitHub Pages, etc.).

## Credits

- **Design, code, art direction:** Christopher Bradford
- **Website:** [https://typer198x.com](https://typer198x.com)

If you stream, teach, or hack on typing games, feel free to fork the project and share improvements—pull requests and fan remixes are always welcome.
