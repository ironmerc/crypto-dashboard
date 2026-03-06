type SchemaObject = {
    $ref?: string;
    type?: string | string[];
    required?: string[];
    properties?: Record<string, SchemaObject>;
    additionalProperties?: boolean | SchemaObject;
    items?: SchemaObject;
    $defs?: Record<string, SchemaObject>;
};

interface ValidateOptions {
    partial?: boolean;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const matchesType = (value: unknown, expected: string) => {
    if (expected === 'null') return value === null;
    if (expected === 'array') return Array.isArray(value);
    if (expected === 'object') return isPlainObject(value);
    if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
    return typeof value === expected;
};

const resolveRef = (root: SchemaObject, ref: string): SchemaObject | null => {
    if (!ref.startsWith('#/')) return null;
    const parts = ref.slice(2).split('/');
    let current: any = root;
    for (const part of parts) {
        if (!current || typeof current !== 'object' || !(part in current)) {
            return null;
        }
        current = current[part];
    }
    return current as SchemaObject;
};

export const validateBySchemaWarnOnly = (
    payload: unknown,
    schema: SchemaObject,
    options: ValidateOptions = {},
    path = '$',
    rootSchema: SchemaObject = schema
): string[] => {
    const warnings: string[] = [];
    const partial = options.partial === true;

    if (schema.$ref) {
        const resolved = resolveRef(rootSchema, schema.$ref);
        if (!resolved) {
            warnings.push(`${path}: unresolved schema ref ${schema.$ref}`);
            return warnings;
        }
        return validateBySchemaWarnOnly(payload, resolved, options, path, rootSchema);
    }

    const expectedTypes = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : [];
    if (expectedTypes.length > 0) {
        const typeOk = expectedTypes.some((expected) => matchesType(payload, expected));
        if (!typeOk) {
            warnings.push(`${path}: expected ${expectedTypes.join('|')} got ${Array.isArray(payload) ? 'array' : payload === null ? 'null' : typeof payload}`);
            return warnings;
        }
    }

    if (schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object') && isPlainObject(payload))) {
        if (!isPlainObject(payload)) return warnings;

        const props = schema.properties || {};
        if (!partial && Array.isArray(schema.required)) {
            for (const req of schema.required) {
                if (!(req in payload)) warnings.push(`${path}.${req}: missing required field`);
            }
        }

        for (const [key, value] of Object.entries(payload)) {
            if (props[key]) {
                warnings.push(...validateBySchemaWarnOnly(value, props[key], options, `${path}.${key}`, rootSchema));
                continue;
            }

            if (schema.additionalProperties === false) {
                warnings.push(`${path}.${key}: unknown key`);
                continue;
            }

            if (isPlainObject(schema.additionalProperties)) {
                warnings.push(...validateBySchemaWarnOnly(value, schema.additionalProperties, options, `${path}.${key}`, rootSchema));
            }
        }
    }

    if (schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array') && Array.isArray(payload))) {
        if (!Array.isArray(payload)) return warnings;
        if (schema.items) {
            payload.forEach((item, idx) => {
                warnings.push(...validateBySchemaWarnOnly(item, schema.items as SchemaObject, options, `${path}[${idx}]`, rootSchema));
            });
        }
    }

    return warnings;
};

export const logSchemaWarnings = (scope: string, warnings: string[]) => {
    warnings.forEach((warning) => {
        console.warn(`[SchemaWarn:${scope}] ${warning}`);
    });
};

