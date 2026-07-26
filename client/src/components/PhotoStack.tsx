import type { PhotoView } from "../../../shared/types.js";

// Deterministic per-position offset/rotation - real siblings, real transforms,
// no box-shadow standing in for depth. photos[0] (the cover) renders last so
// it sits physically on top.
const LAYER_OFFSETS = [
  { x: 0, y: 0, rotate: -1.5 },
  { x: 6, y: -5, rotate: 3 },
  { x: -7, y: 4, rotate: -4 },
  { x: 5, y: 6, rotate: 4.5 },
  { x: -5, y: -6, rotate: -3 },
];

export function PhotoStack({ photos }: { photos: PhotoView[] }) {
  const backing = photos.slice(1);
  const cover = photos[0];

  return (
    <div className="photo-stack">
      {backing.map((photo, i) => {
        const offset = LAYER_OFFSETS[(i + 1) % LAYER_OFFSETS.length]!;
        return (
          <img
            key={photo.url}
            className="photo-stack__layer"
            src={photo.thumbUrl}
            alt=""
            style={{
              zIndex: i + 1,
              transform: `translate(${offset.x}px, ${offset.y}px) rotate(${offset.rotate}deg)`,
            }}
          />
        );
      })}
      {cover && (
        <img
          className="photo-stack__layer photo-stack__cover"
          src={cover.thumbUrl}
          alt={cover.aiDescription ?? ""}
          style={{
            zIndex: photos.length,
            transform: `rotate(${LAYER_OFFSETS[0]!.rotate}deg)`,
          }}
        />
      )}
    </div>
  );
}
