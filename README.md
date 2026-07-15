# Paper

A cozy side-scrolling silhouette roguelike prototype about flying a paper airplane through dreamlike childhood spaces.

The current prototype includes a dive-and-lift flight model, delivery missions, procedural silhouette chunks, basic obstacle collisions, wind zones, run pickups, plane durability, message condition, distance tracking, mood palettes, particles, and crash/restart flow.

## Prototype controls

- `W` / `ArrowUp`: pitch up and convert speed into lift.
- `S` / `ArrowDown` / `Space`: dive to gain speed.
- `Enter` / click: advance from briefing to the launch point.
- Click/touch and drag back from the plane, then release: launch.
- Drag / touch above or below the plane during flight: steer on pointer devices.
- `M`: mute or unmute procedural audio.
- `R`: restart after a crash.

## Development

This prototype is dependency-free and runs as a static web page.

```bash
npm run dev
```

Then open <http://localhost:5173>.

The app uses relative asset paths so it can be hosted from a GitHub Pages project path such as `/Paper/`.

Mission and palette data live in `src/data.js`; reusable math helpers live in `src/math.js`; procedural browser audio lives in `src/audio.js`; gameplay and rendering logic live in `src/main.js`.

## Build / checks

GitHub Actions runs the same build and test checks on pull requests and pushes to `main`. A separate Pages workflow deploys the static site from `main` to GitHub Pages after the same checks pass.

```bash
npm run build
npm test
```
