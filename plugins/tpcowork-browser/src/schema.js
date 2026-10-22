import { z } from 'zod';
import { browserCommandSchema } from '../vendor/tpcowork/packages/shared/src/browser-use/commands.ts';
export { browserCommandSchema };
// One bundled Zod instance for every Host module that validates.
export { z };

export { toolGroups } from './tool-routing.js';

/** DSH's schema vocabulary supplies documentation; Zod enforces the full reference constraints. */
function spec(node) {
  if (node.oneOf || node.anyOf) {
    const options = (node.oneOf ?? node.anyOf).map(spec);
    return options.length === 1 ? options[0] : { oneOf: options };
  }
  if (!node.type) return { type: 'json' };
  const result = { type: node.type };
  if (node.description) result.description = node.description;
  if ('const' in node) result.const = node.const;
  if (node.enum) result.enum = node.enum;
  if (node.type === 'object') {
    result.additionalProperties = node.additionalProperties !== false;
    result.properties = Object.fromEntries(Object.entries(node.properties ?? {}).map(([key, value]) => [key,
      { ...spec(value), ...(node.required?.includes(key) ? { required: true } : {}) }]));
  }
  if (node.type === 'array' && node.items) result.items = spec(node.items);
  return result;
}
export function commandSpec(methods) {
  const options = browserCommandSchema.options.filter(option => methods.includes(option.shape.method.value));
  if (options.length === 0) throw new Error(`No browser operations match ${methods.join(', ')}`);
  const definitions = options.map(option => spec(z.toJSONSchema(option, { unrepresentable: 'any', io: 'input' })));
  return {
    oneOf: [...definitions, { type: 'string', description: 'A JSON-encoded browser command object. The decoded object must satisfy the same operation schema.' }],
    description: 'Pass a browser command object with a method field. A JSON string encoding that object is also accepted.',
    required: true,
  };
}

export function parseCommand(value, methods) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); }
    catch (error) { throw new Error('command must be a browser command object or a valid JSON string encoding one.', { cause: error }); }
  }
  const command = browserCommandSchema.parse(value);
  if (methods && !methods.includes(command.method)) throw new Error(`Operation ${command.method} is not available in this tool`);
  return command;
}
