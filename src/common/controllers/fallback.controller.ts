import { All, Controller, NotFoundException } from '@nestjs/common';
import { Public } from '../decorators/public.decorator.js';

/**
 * Catch-all so unmatched routes return the canonical JSON error envelope
 * instead of Express's HTML 404 page. Registered last; never shadows
 * concrete controllers.
 */
@Controller()
export class FallbackController {
  @Public()
  @All('*')
  notFound(): never {
    throw new NotFoundException('Route not found');
  }
}