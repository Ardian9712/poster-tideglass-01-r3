import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const maxBytes = 1_048_576;
const expectedDimension = 1024;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(scriptDirectory, "source-image.jpg");
const outputDirectory = resolve(
  scriptDirectory,
  process.env.MAKEFUN_OUTPUT_DIR ?? "/output",
);
const outputPath = join(outputDirectory, "entry.png");
const frameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6,
  0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

// Read a start-of-frame header; never decode or re-encode the poster.
function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) {
    throw new Error("Invalid JPEG: missing start-of-image signature (FF D8).");
  }
  if (bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) {
    throw new Error("Invalid JPEG: missing end-of-image marker (FF D9).");
  }

  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      throw new Error(`Invalid JPEG: expected a header marker at byte ${offset}.`);
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) {
      throw new Error("Invalid JPEG: truncated header marker.");
    }

    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0x00 || marker === 0xd8) {
      throw new Error("Invalid JPEG: unexpected marker in the image header.");
    }
    if (offset + 2 > bytes.length) {
      throw new Error("Invalid JPEG: truncated header segment length.");
    }

    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      throw new Error("Invalid JPEG: invalid or truncated header segment.");
    }
    if (frameMarkers.has(marker)) {
      if (segmentLength < 8) {
        throw new Error("Invalid JPEG: truncated start-of-frame header.");
      }
      const components = bytes[offset + 7];
      if (components === 0 || segmentLength !== 8 + 3 * components) {
        throw new Error("Invalid JPEG: malformed start-of-frame header.");
      }
      return {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      };
    }
    offset += segmentLength;
  }
  throw new Error("Invalid JPEG: no start-of-frame dimensions before image data.");
}

const sourceBytes = await readFile(sourcePath);
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, sourceBytes);

// Validate the file actually written to disk, including byte-for-byte identity.
const writtenBytes = await readFile(outputPath);
if (writtenBytes.length > maxBytes) {
  throw new Error(
    `Output exceeds the size limit: ${writtenBytes.length} bytes; maximum ${maxBytes} bytes.`,
  );
}
const { width, height } = jpegDimensions(writtenBytes);
if (width !== expectedDimension || height !== expectedDimension) {
  throw new Error(`Output JPEG must be 1024x1024 pixels; found ${width}x${height}.`);
}
if (!writtenBytes.equals(sourceBytes)) {
  throw new Error("Output is not byte-identical to source-image.jpg.");
}

const sha256 = createHash("sha256").update(writtenBytes).digest("hex");
console.log(`Success: ${outputPath} | ${writtenBytes.length} bytes | SHA-256 ${sha256}`);
