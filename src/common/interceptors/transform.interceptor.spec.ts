import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { TransformInterceptor } from './transform.interceptor.js';
import type { ResponseEnvelope } from '../helpers/response-envelope.js';

function run(data: unknown): Promise<ResponseEnvelope<unknown>> {
  const context = {} as ExecutionContext;
  const next: CallHandler<unknown> = { handle: () => of(data) };
  return lastValueFrom(new TransformInterceptor().intercept(context, next));
}

describe('TransformInterceptor', () => {
  it('wraps a payload in the success envelope', async () => {
    const result = await run({ id: 'abc' });
    expect(result).toMatchObject({
      success: true,
      data: { id: 'abc' },
      message: 'OK',
      errors: [],
    });
    expect(typeof result.timestamp).toBe('string');
    expect(new Date(result.timestamp as string).getTime()).not.toBeNaN();
  });

  it('coerces undefined payloads to null', async () => {
    const result = await run(undefined);
    expect(result.data).toBeNull();
  });
});