import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { PasswordService } from './password.service.js';
import { TokensService } from './tokens.service.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  providers: [AuthService, PasswordService, TokensService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService, TokensService, PasswordService],
})
export class AuthModule {}