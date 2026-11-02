/** Tiny pixel-art sprites drawn as SVG rects. Each char is one pixel. */
const SPRITES = {
  research: [
    "....aaaa....",
    "....a..a....",
    "..bbbbbbbb..",
    ".bccccccccb.",
    ".bcwkccwkcb.",
    ".bccccccccb.",
    ".bcccmmcccb.",
    "..bbbbbbbb..",
    "...dbbbbd...",
    "..ddbbbbdd..",
    "..d.b..b.d..",
    "....b..b....",
  ],
  shopping: [
    "...a....a...",
    "....a..a....",
    "..bbbbbbbb..",
    ".bccccccccb.",
    ".bckwcckwcb.",
    ".bccccccccb.",
    ".bccmmmmccb.",
    "..bbbbbbbb..",
    ".eebbbbbbee.",
    ".eebbbbbbee.",
    "...b....b...",
    "..bb....bb..",
  ],
  owner: [
    "...dddddd...",
    "..dddddddd..",
    "..dssssssd..",
    "..swkssswk..",
    "..ssssssss..",
    "..sssmmsss..",
    "...ssssss...",
    "..cccccccc..",
    ".cccaccaccc.",
    ".ccccaacccc.",
    ".cc.cccc.cc.",
    "....c..c....",
  ],
  chest: [
    "............",
    "..aaaaaaaa..",
    ".abbbbbbbba.",
    ".abbbbbbbba.",
    ".aaaaccaaaa.",
    ".abbbccbbba.",
    ".abbbbbbbba.",
    ".abbbbbbbba.",
    ".aaaaaaaaaa.",
    "............",
    "............",
    "............",
  ],
} as const;

const PALETTES: Record<keyof typeof SPRITES, Record<string, string>> = {
  research: { a: "#ffd23f", b: "#f4f0e6", c: "#5cc8ff", w: "#ffffff", k: "#141428", m: "#141428", d: "#a9a4c4" },
  shopping: { a: "#ffd23f", b: "#f4f0e6", c: "#b48cff", w: "#ffffff", k: "#141428", m: "#141428", e: "#3ddc84" },
  owner: { d: "#6b3e26", s: "#f2c9a0", w: "#ffffff", k: "#141428", m: "#c0392b", c: "#ffd23f", a: "#141428" },
  chest: { a: "#6b3e26", b: "#b8860b", c: "#ffd23f" },
};

export type SpriteName = keyof typeof SPRITES;

export function Sprite({ name, size = 48, label }: { name: SpriteName; size?: number; label?: string }) {
  const rows = SPRITES[name];
  const pal = PALETTES[name];
  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {rows.flatMap((row, y) =>
        [...row].map((ch, x) => (pal[ch] ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={pal[ch]} /> : null)),
      )}
    </svg>
  );
}
