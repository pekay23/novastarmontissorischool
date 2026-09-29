# Architecture Documentation

This folder contains architecture diagrams and technical design documents.

## Contents

| File | Description | Tool |
|------|-------------|------|
| `system-overview.excalidraw` | High-level system architecture (public site, portal, DB, sync) | Excalidraw |
| `data-model.excalidraw` | Entity-relationship diagram (to be created) | Excalidraw |
| `deployment.excalidraw` | Cloud + local deployment topology (to be created) | Excalidraw |
| `sync-flow.excalidraw` | Offline sync data flow (to be created) | Excalidraw |
| `rbac-model.excalidraw` | Dynamic RBAC with delegation (to be created) | Excalidraw |

## Viewing Diagrams

All `.excalidraw` files can be opened at **[excalidraw.com](https://excalidraw.com)**:
1. Go to excalidraw.com
2. Click "Open from file" (or drag & drop)
3. Select the `.excalidraw` file

## Diagram Standards

- **Colors:** Use Tailwind CSS v4 color palette (OKLCH)
- **Shapes:** Rectangles = services/apps, Cylinders = databases, Diamonds = decisions
- **Arrows:** Solid = sync/data flow, Dashed = async/events, Dotted = fallback
- **Labels:** Include tech stack (Next.js 16, Neon, Supabase, etc.)
- **Legend:** Every diagram includes a legend

## Related

- Wireframes: `../wireframes/`
- ADRs: `../adr/`
- API Specs: `../api/`