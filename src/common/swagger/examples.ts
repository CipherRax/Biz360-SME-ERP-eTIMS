import type { OpenAPIObject } from '@nestjs/swagger';

interface SchemaObject {
  type?: string;
  format?: string;
  enum?: unknown[];
  properties?: Record<string, unknown>;
  items?: unknown;
  example?: unknown;
  oneOf?: unknown[];
  anyOf?: unknown[];
  required?: string[];
  $ref?: string;
}

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

function byName(name: string): string | undefined {
  const k = name.toLowerCase();
  if (k.endsWith('_id') || (k.endsWith('id') && k !== 'id')) {
    const prefix = k.replace(/[_-]?id$/, '');
    if (prefix.includes('organization')) return 'org_123e4567e89b12d3a456426614174000';
    if (/party|customer|supplier|seller/.test(prefix)) return '123e4567-e89b-12d3-a456-426614174001';
    if (/item|product/.test(prefix)) return '123e4567-e89b-12d3-a456-426614174002';
    if (/invoice|order|quotation|quote|receipt|note|po/.test(prefix)) return '123e4567-e89b-12d3-a456-426614174003';
    if (/bank|category|unit|user|account/.test(prefix)) return '123e4567-e89b-12d3-a456-426614174004';
    return uuid();
  }
  if (k.includes('email')) return 'client@example.com';
  if (k.includes('password')) return 'Str0ngPassw0rd!';
  if (k.includes('token')) return uuid() + uuid();
  if (k === 'name') return 'Acme Traders Ltd';
  if (k.includes('bank') && k.includes('name')) return 'Equity Bank';
  if (k.includes('item') && k.includes('name')) return 'Premium Widget';
  if (k.includes('category') && k.includes('name')) return 'Electronics';
  if (k.includes('unit') && k.includes('name')) return 'Pieces';
  if (k.includes('organization') && k.includes('name')) return 'Acme Traders Ltd';
  if (k.includes('phone') || k === 'mobile') return '+254700000000';
  if (/tax.*(pin|id)|krapin|^\s*pin\s*$/.test(k)) return 'P000000000V';
  if (k.includes('address')) return 'Moi Avenue, Nairobi';
  if (k.includes('city') || k.includes('town')) return 'Nairobi';
  if (k !== 'code' && k.includes('code')) return 'ACC-001';
  if (k === 'code') return '1000';
  if (k.includes('sku')) return 'SKU-0001';
  if (k.includes('barcode')) return '8901234567890';
  if (k.includes('currency')) return 'KES';
  if (k.includes('reason')) return 'Contractual adjustment';
  if (k.includes('reference') || k.endsWith('ref') || k === 'ref') return 'REF-1024';
  if (k.includes('number') || k === 'no') return '000123';
  if (k.includes('format')) return 'INV-{YYYY}-{SEQ:6}';
  if (/taxrate/.test(k)) return '16';
  if (/discountpct|discount/.test(k)) return '5';
  if (k.includes('rate') && !/taxrate/.test(k)) return '16';
  if (k === 'quantity' || k === 'qty' || k === 'qtyReceived' || k === 'qtyreceived') return '5';
  if (/^amount$|unitprice|price|total|subtotal|lineamount|linetotal|lineamountcredit/.test(k)) return '1000.00';
  if (k.includes('amount')) return '1000.00';
  if (/date|paidat|validuntil|deadline|due/.test(k)) return new Date().toISOString().slice(0, 10);
  if (k.includes('notes') || k.includes('description')) return 'Optional notes for the transaction';
  return undefined;
}

function sample(
  schema: SchemaObject,
  name: string,
  schemas: Record<string, SchemaObject>,
  depth = 0,
  seen: Set<string> = new Set(),
): unknown {
  if (schema.example !== undefined) return schema.example;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  if (schema.$ref) {
    if (depth > 3) return {};
    const refName = schema.$ref.split('/').pop() ?? '';
    const target = (schemas[refName] ?? {}) as SchemaObject;
    if (seen.has(refName)) return {};
    const nextSeen = new Set(seen).add(refName);
    return sample(target, '', schemas, depth + 1, nextSeen);
  }
  if (schema.oneOf?.length) return sample(schema.oneOf[0] as SchemaObject, name, schemas, depth, seen);
  if (schema.anyOf?.length) return sample(schema.anyOf[0] as SchemaObject, name, schemas, depth, seen);
  const named = byName(name);
  if (named !== undefined) return named;
  if (schema.type === 'string') {
    if (schema.format === 'date-time') return new Date().toISOString();
    if (schema.format === 'date') return new Date().toISOString().slice(0, 10);
    if (schema.format === 'uuid') return uuid();
    if (schema.format === 'email') return 'client@example.com';
    return 'string';
  }
  if (schema.type === 'integer') return 1;
  if (schema.type === 'number') return 1;
  if (schema.type === 'boolean') return true;
  if (schema.type === 'array') {
    const item = schema.items as SchemaObject | undefined;
    return [item ? sample(item, '', schemas, depth, seen) : 'string'];
  }
  if (schema.type === 'object' || schema.properties) {
    const out: Record<string, unknown> = {};
    const required = (schema.required ?? []) as string[];
    const props = (schema.properties ?? {}) as Record<string, SchemaObject>;
    const useKeys = Array.isArray(required) && required.length > 0 ? required : Object.keys(props);
    for (const key of useKeys.slice(0, 8)) {
      out[key] = sample(props[key] ?? {}, key, schemas, depth, seen);
    }
    return out;
  }
  return null;
}

function schemaNameFromRef($ref: string): string {
  return $ref.split('/').pop() ?? '';
}

/**
 * Walks the OpenAPI document and injects `example` values into every schema
 * definition and every request schema so the Swagger UI "Try it out" panel
 * is pre-populated with an editable template.
 */
export function enrichOpenApiWithExamples(document: OpenAPIObject): OpenAPIObject {
  const schemas = document.components?.schemas as Record<string, SchemaObject> | undefined;
  if (!schemas) return document;

  const resolve = (s: SchemaObject | undefined): SchemaObject | undefined => {
    let sRef = s;
    const seen = new Set<string>();
    while (sRef && sRef.$ref) {
      const n = schemaNameFromRef(sRef.$ref);
      if (seen.has(n)) return sRef;
      seen.add(n);
      sRef = schemas[n];
    }
    return sRef;
  };

  for (const [, schema] of Object.entries(schemas)) {
    if (!schema.properties) continue;
    const def = resolve(schema) ?? schema;
    if (!def.properties) continue;
    for (const [key, propRaw] of Object.entries(def.properties)) {
      const prop = propRaw as SchemaObject;
      if (prop.example !== undefined) continue;
      prop.example = sample(resolve(prop) ?? prop, key, schemas);
    }
    if (schema.example === undefined) {
      schema.example = sample(schema, '', schemas);
    }
  }

  const walkRequestBodies = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walkRequestBodies);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.content && typeof obj.content === 'object') {
      for (const content of Object.values(obj.content as Record<string, unknown>)) {
        const c = content as { schema?: SchemaObject };
        if (c?.schema) {
          const resolved = resolve(c.schema) ?? c.schema;
          if (resolved.properties) {
            c.schema.example = sample(resolved, '', schemas);
          }
        }
      }
    }
    for (const v of Object.values(obj)) walkRequestBodies(v);
  };
  if (document.paths) walkRequestBodies(document.paths);

  return document;
}