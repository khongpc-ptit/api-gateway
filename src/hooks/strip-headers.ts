import { FastifyRequest } from 'fastify';

/**
 * Hook to strip spoofed client headers according to BA - SOA.md §2 & §4:
 * "Owner: Gateway • Không được làm: tin header identity/service-key do client gửi"
 * "Client header x-user-id/x-user-role không có thẩm quyền."
 */
export async function stripSpoofedHeadersHook(request: FastifyRequest): Promise<void> {
  delete request.headers['x-user-id'];
  delete request.headers['x-user-role'];
  delete request.headers['x-service-key'];
}
