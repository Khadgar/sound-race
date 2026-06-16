/**
 * Block colors used for collectible blocks ("cars" in Audiosurf parlance).
 * Order is intentional — the index is stored in TrackData events.
 *
 * 0: red    — bass-dominant beats
 * 1: pink   — mid-dominant beats
 * 2: cyan   — treble-dominant beats
 * 3: yellow — full-spectrum / drops
 */
export const BLOCK_PALETTE = [0xff3d6e, 0xff5dc8, 0x5df0ff, 0xfff066] as const;
export const OBSTACLE_COLOR = 0x4a4458;
export const OBSTACLE_OUTLINE = 0xa6a0c0;

export function blockColorHex(idx: number): number {
  return BLOCK_PALETTE[((idx % BLOCK_PALETTE.length) + BLOCK_PALETTE.length) % BLOCK_PALETTE.length]!;
}
