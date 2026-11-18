# Generated texture assets

These 512 x 512 color maps were generated for Bridgehead and are loaded by the existing Three.js renderer. They add no model downloads or extra runtime dependencies.

| File | Use |
|---|---|
| `grass.png` | Forest ground triplanar albedo layer |
| `snow.png` | Snow theatre ground triplanar albedo layer |
| `sand.png` | Desert and urban ground triplanar albedo layer |
| `swamp.png` | Swamp ground triplanar albedo layer |
| `bark.png` | Tree trunks and pine trunks |
| `leaves.png` | Deciduous tree canopies |
| `vehicle-paint.png` | Cars, trucks, tanks, and buses |
| `tire-rubber.png` | Vehicle wheels |

The maps are color/albedo textures. Lighting and fine relief continue to come from the existing world lights and `src/surface.js` detail shader.
