import type { PhotoView } from "../../../shared/types.js";

export function PhotoGallery({ photos }: { photos: PhotoView[] }) {
  return (
    <div className="photo-gallery">
      {photos.map((photo) => (
        <img
          key={photo.url}
          className="photo-gallery__photo"
          src={photo.url}
          alt={photo.aiDescription ?? ""}
        />
      ))}
    </div>
  );
}
