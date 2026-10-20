import { Graphics, Sprite, type Renderer } from 'pixi.js';
import { drawLook, lookOf } from './art';

/** Class art is drawn at this many pixels per tile, then scaled. */
export const TEX = 32;
/** Sprite textures are rasterised at this multiple of TEX, so zooming in stays sharp. */
export const TEX_RESOLUTION = 2;

/**
 * A class's art as a PNG data URL, drawn exactly like its in-game sprite.
 * `scaleFor` gets the sprite's natural size and returns the scale to draw it at.
 */
export async function renderClassImage(
  renderer: Renderer,
  parts: readonly string[],
  colour: number,
  scaleFor: (width: number, height: number) => number,
): Promise<string> {
  const g = new Graphics();
  drawLook(g, lookOf(parts), colour, TEX, true);
  const tex = renderer.generateTexture({ target: g, resolution: 4 });
  g.destroy();
  const sprite = new Sprite(tex);
  sprite.scale.set(scaleFor(sprite.width, sprite.height));
  try {
    return await renderer.extract.base64({ target: sprite, resolution: 2 });
  } finally {
    sprite.destroy();
    tex.destroy(true);
  }
}
