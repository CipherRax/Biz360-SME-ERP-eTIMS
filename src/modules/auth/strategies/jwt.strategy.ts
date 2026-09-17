import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';

export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: string;
  orgId: string;
  tokenVersion: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('auth.accessSecret'),
      issuer: 'biz360-erp',
      audience: 'biz360-erp-api',
      algorithms: ['HS256'],
    });
  }

  validate(payload: AccessTokenClaims): AuthenticatedUser {
    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      orgId: payload.orgId,
    };
  }
}