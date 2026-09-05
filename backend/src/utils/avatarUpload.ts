import multer from "multer";
import sharp from "sharp";

/** Shared multer config for a single optional/required "avatar" image field - used by the profile avatar endpoint and invite-accept. */
export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG, or WebP images are allowed"));
  },
});

/**
 * Resizes an uploaded avatar to a consistent 256x256 JPEG.
 * .rotate() with no args applies the EXIF orientation tag (phone cameras
 * store the sensor image unrotated and just flag how to display it) then
 * strips it, so the resize/crop below operates on the upright image.
 */
export async function resizeAvatar(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).rotate().resize(256, 256, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
}
