import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  sub: string;
  email: string;
  role: string;
  orgId: string;
  /** Present on API-key sessions; used for scope-based authorization. */
  scopes?: string[];
}

/** Injects the authenticated user payload (populated by the JWT strategy). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined => {
    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
    }>();
    return request.user;
  },
);