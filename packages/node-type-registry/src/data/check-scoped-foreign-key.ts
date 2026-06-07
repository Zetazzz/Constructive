import type { NodeTypeDefinition } from '../types';

export const CheckScopedForeignKey: NodeTypeDefinition = {
  name: 'CheckScopedForeignKey',
  slug: 'check_scoped_foreign_key',
  category: 'check',
  display_name: 'Check Scoped Foreign Key',
  description:
    'BEFORE INSERT trigger that validates all FK references resolve to the same scope value (e.g. database_id). Prevents cross-scope linking where a user with access to multiple scopes could create invalid cross-scope references. Works on junction tables (2+ FKs) and child tables (1 FK validated against the row\'s own scope field).',
  parameter_schema: {
    type: 'object',
    properties: {
      scope_field: {
        type: 'string',
        format: 'column-ref',
        description:
          'Scope field on this table to validate against (e.g. "database_id"). If set, the trigger also checks that all referenced scope values match NEW.scope_field. If omitted, only checks that all references match each other.',
        default: 'database_id'
      },
      references: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              format: 'column-ref',
              description: 'FK field on this table (e.g. "view_id")'
            },
            ref_table: {
              type: 'string',
              description:
                'Target table name (e.g. "view"). Schema is resolved from the table registry.'
            },
            ref_field: {
              type: 'string',
              format: 'column-ref',
              description: 'PK field on the target table (e.g. "id")',
              default: 'id'
            },
            ref_scope_field: {
              type: 'string',
              format: 'column-ref',
              description:
                'Scope field on the target table to read (e.g. "database_id")',
              default: 'database_id'
            }
          },
          required: ['field', 'ref_table']
        },
        description:
          'FK references to validate. Each target\'s scope field must resolve to the same value.',
        minItems: 1
      }
    },
    required: ['references']
  },
  tags: ['check', 'trigger', 'security', 'scope-isolation', 'foreign-key']
};
