import { FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';

// BA - SOA.md §18: "tối đa 5 MiB (5.242.880 byte) mỗi ảnh"
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5,242,880 bytes

/**
 * Early payload limit check hook for multipart image uploads.
 * If incoming Content-Length exceeds 5 MiB, aborts immediately with 413 PAYLOAD_TOO_LARGE.
 */
export async function payloadLimitHook(request: FastifyRequest): Promise<void> {
  const contentLength = request.headers['content-length'];
  if (contentLength && typeof contentLength === 'string') {
    const bytes = parseInt(contentLength, 10);
    if (!isNaN(bytes) && bytes > MAX_UPLOAD_BYTES) {
      throw AppError.payloadTooLarge(
        `Payload size of ${bytes} bytes exceeds maximum allowed limit of 5 MiB (${MAX_UPLOAD_BYTES} bytes)`
      );
    }
  }
}
