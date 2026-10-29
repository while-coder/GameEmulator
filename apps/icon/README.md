# Game Emulator icon

Generated with the built-in image_gen tool. The universal controller represents the multi-system launcher, including NES and arcade.

- `icon.png`: generated RGBA source with transparent outer corners.
- `icon-fullbleed.png`: opaque 1024px RGB version, produced by Tauri's iOS icon conversion with background `#0f172a` (`ios/AppIcon-512@2x.png`), then saved as RGB to remove the alpha channel.
- `icons.json`: native icon generation inputs.

Run `pnpm sync:icons` to refresh Web, Windows, Linux, Android, and iOS resources. macOS icon generation runs on macOS.

## Generation prompt

Use case: logo-brand. Asset type: production application icon for Game Emulator, a multi-system game emulator supporting both arcade and home consoles. Generate ONE polished square 1024x1024 icon. Subject: a bold friendly universal gamepad symbol, with a simple sculpted ivory-white controller silhouette with two ergonomic grips, one dark directional cross on the left and four colored circular action buttons in a diamond on the right. Controller should be generic, not a recognizable console brand. Behind it is a rounded-square deep indigo app tile with a subtle blue to violet gradient and restrained soft dimensional lighting. Elegant simplified vector-like rendering with crisp edges, large shapes and excellent readability at 32px. Center the controller within the central 62 percent of the canvas so mobile masks keep it intact. Rounded-square tile occupies about 94 percent of the canvas, outside corners genuinely transparent. Straight-on balanced composition, compact and distinctive, professional desktop app quality. No text, no letters, no numbers, no extra objects, no orbit rings, no NES rectangular controller, no red-white console styling, no watermark. Save the generated image and return its local file path.
