# Paper

A cozy side-scrolling silhouette roguelike prototype about flying a paper airplane through dreamlike childhood spaces.

The current prototype includes a dive-and-lift flight model, procedural silhouette chunks, basic obstacle collisions, wind zones, run pickups, plane durability, message condition, distance tracking, and crash/restart flow.

## Prototype controls

- `W` / `ArrowUp`: pitch up and convert speed into lift.
- `S` / `ArrowDown` / `Space`: dive to gain speed.
- `R`: restart after a crash.

## Development

This prototype is dependency-free and runs as a static web page.

```bash
npm run dev
```

Then open <http://localhost:5173>.

## Build / checks

```bash
npm run build
```
