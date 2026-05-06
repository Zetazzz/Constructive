import type { NodeTypeDefinition } from '../types';

export const AuthzAppMembership: NodeTypeDefinition = {
  name: 'AuthzAppMembership',
  slug: 'authz_app_membership_check',
  category: 'authz',
  display_name: 'App Membership Check',
  description:
    'App-level membership check (membership_type=1). Verifies the user has app membership (optionally with specific permission) without binding to any entity from the row. Uses EXISTS subquery against SPRT table. Replaces AuthzMembership for clarity.',
  parameter_schema: {
    type: 'object',
    properties: {
      membership_type: {
        type: ['integer', 'string'],
        description:
          'Scope: 1=app, 2=org, 3+=dynamic entity types (or string name resolved via membership_types_module)',
      },
      entity_type: {
        type: 'string',
        description:
          "Entity type prefix (e.g. 'channel', 'department'). Resolved to membership_type integer via memberships_module lookup. Use instead of membership_type for readability.",
      },
      permission: {
        type: 'string',
        description:
          'Single permission name to check (resolved to bitstring mask)',
      },
      permissions: {
        type: 'array',
        items: {
          type: 'string',
        },
        description:
          'Multiple permission names to check (ORed together into mask)',
      },
      is_admin: {
        type: 'boolean',
        description: 'If true, require is_admin flag',
      },
      is_owner: {
        type: 'boolean',
        description: 'If true, require is_owner flag',
      },
    },
    required: [],
  },
  tags: ['membership', 'authz'],
};
