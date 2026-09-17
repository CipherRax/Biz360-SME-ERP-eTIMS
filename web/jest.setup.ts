import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'node:util';

// jsdom does not expose TextDecoder/TextEncoder; the JWT decoder relies on them.
if (typeof globalThis.TextDecoder === 'undefined') {
  (globalThis as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
}
if (typeof globalThis.TextEncoder === 'undefined') {
  (globalThis as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
}