/** Canonical API response envelope. Every endpoint returns this shape. */

export interface ResponseEnvelope<T = unknown> {
  success: boolean;
  data: T | null;
  message: string;
  timestamp: string;
  errors: Array<{ message: string; path?: string }>;
}

export function ok<T>(data: T, message = 'OK'): ResponseEnvelope<T> {
  return {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
    errors: [],
  };
}

export function fail(
  message: string,
  errors: Array<{ message: string; path?: string }> = [],
): ResponseEnvelope<null> {
  return {
    success: false,
    data: null,
    message,
    timestamp: new Date().toISOString(),
    errors,
  };
}