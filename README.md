# PandaDoom

PandaDoom is a small, original Doom-like browser game. It contains one bamboo-sanctuary level, five panda threats, a bamboo dart blaster, and a reactive panda status face. It does not include code or artwork from Doom.

## Play locally

Open `index.html` directly in a modern browser. For behavior closest to a hosted copy, serve the directory with any static web server. For example:

```sh
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Controls:

- Move with WASD or the arrow keys.
- Aim the movable target in every direction with the mouse or I/J/K/L. With the mouse, keep moving at the horizontal edges to turn.
- Turn with Q/E or the left/right arrow keys.
- Fire with the mouse button or Space.
- Press Esc to pause.
- On a touch device, use the on-screen controls.

## Share it

The site is completely static and has no build step. Upload `index.html`, `style.css`, and `game.js` together to any directory served by a website. The game does not collect data or contact external services.

If the site is placed below a domain root, such as `https://example.com/pandadoom/`, no path changes are needed because all file references are relative.
