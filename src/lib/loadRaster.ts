import type { RgbaRaster } from "./grid.ts";
import { DECODE_ERROR, inspectImageFile } from "./imageFile.ts";

export const MAX_RASTER_EDGE = 1200;

export interface LoadedRaster {
  raster: RgbaRaster;
  scaledDown: boolean;
}

function bitmapToRaster(bitmap: ImageBitmap): RgbaRaster {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器不能读取这张图片的像素。");
  context.drawImage(bitmap, 0, 0);
  const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
  return { width: bitmap.width, height: bitmap.height, data: image.data };
}

export async function fileToRaster(file: File): Promise<LoadedRaster> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const inspected = inspectImageFile(file.size, header);
  if (!inspected.ok) throw new Error(inspected.message);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(DECODE_ERROR);
  }
  if (bitmap.width < 1 || bitmap.height < 1) {
    bitmap.close();
    throw new Error(DECODE_ERROR);
  }

  let scaledDown = false;
  const longEdge = Math.max(bitmap.width, bitmap.height);
  if (longEdge > MAX_RASTER_EDGE) {
    const scale = MAX_RASTER_EDGE / longEdge;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    bitmap.close();
    try {
      bitmap = await createImageBitmap(file, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: "high",
      });
    } catch {
      throw new Error(DECODE_ERROR);
    }
    scaledDown = true;
  }

  try {
    return { raster: bitmapToRaster(bitmap), scaledDown };
  } finally {
    bitmap.close();
  }
}

export async function blobToRaster(blob: Blob): Promise<RgbaRaster> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error(DECODE_ERROR);
  }
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error(DECODE_ERROR);
    return bitmapToRaster(bitmap);
  } finally {
    bitmap.close();
  }
}

export function rasterToPngBlob(raster: RgbaRaster): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("无法保存图片副本"));
  const copy = new Uint8ClampedArray(raster.data);
  context.putImageData(new ImageData(copy, raster.width, raster.height), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("无法保存图片副本"));
      else resolve(blob);
    }, "image/png");
  });
}
