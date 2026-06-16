import type { NodeTypeDefinition } from '../types';

export const AuthzFilePath: NodeTypeDefinition = {
  name: 'AuthzFilePath',
  slug: 'authz_file_path',
  category: 'authz',
  display_name: 'File Path Share',
  description: 'Path-scoped file sharing via ltree containment. Grants access when a path_shares row matches the current user, bucket, and an ancestor path with the required permission.',
  parameter_schema: {
    type: 'object',
    properties: {
      shares_schema: {
        type: 'string',
        description: 'Schema of the path_shares table'
      },
      shares_table: {
        type: 'string',
        description: 'Name of the path_shares table'
      },
      files_schema: {
        type: 'string',
        description: 'Schema of the files table (used to qualify column references inside the EXISTS subquery)'
      },
      files_table: {
        type: 'string',
        description: 'Name of the files table (used to qualify column references inside the EXISTS subquery)'
      },
      permission_field: {
        type: 'string',
        format: 'column-ref',
        description: 'Boolean column on the path_shares table that grants the required permission (e.g. can_read, can_write)'
      },
      bucket_field: {
        type: 'string',
        format: 'column-ref',
        description: 'Column on the files table referencing the bucket',
        default: 'bucket_id'
      },
      path_field: {
        type: 'string',
        format: 'column-ref',
        description: 'Ltree column on the files table representing the file path',
        default: 'path'
      }
    },
    required: [
      'shares_schema',
      'shares_table',
      'files_table',
      'permission_field'
    ]
  },
  tags: [
    'storage',
    'authz'
  ]
};
