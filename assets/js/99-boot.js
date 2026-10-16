// Type-R 198X — boot. Must be the last script in index.html: instantiates the Game after every core/* and game/* module has loaded.

// ----------------------------- Boot -----------------------------
const game = new Game();

// Ensure menu visible on load
game.setMode("menu");
game.refreshMenu();
window.game = game;
