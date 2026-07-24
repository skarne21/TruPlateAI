const MAX_EDGE = 1024;

/** Shrink a photo before it leaves the device.
 *
 * A phone photo is several megabytes and neither Gemini nor storage needs that
 * resolution to see a plate of food. The same downscaled blob is sent to
 * /analyze and later uploaded to Storage, so it is paid for once -- which
 * matters more now that a meal can carry several photos.
 */
export async function downscaleImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

  if (scale === 1 && file.type === "image/jpeg") {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not process that image"))),
      "image/jpeg",
      0.85
    )
  );
}
