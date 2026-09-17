import { NextRequest } from 'next/server';
import { proxyPublicAuthPost } from '@/lib/server/auth-proxy';

export async function POST(request: NextRequest) {
  return proxyPublicAuthPost(request, '/auth/password/forgot');
}
