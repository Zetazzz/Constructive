/**
 * Tests for JSDoc comment sanitization in babel-ast and hooks-ast
 */
import * as t from '@babel/types';

import {
  addJSDocComment,
  generateCode,
} from '../../core/codegen/babel-ast';
import { addJSDocComment as addJSDocCommentHooks } from '../../core/codegen/hooks-ast';

describe('addJSDocComment', () => {
  describe('babel-ast', () => {
    it('produces valid JSDoc for simple descriptions', () => {
      const node = t.identifier('x');
      addJSDocComment(node, ['A simple description']);
      const code = generateCode([
        t.variableDeclaration('const', [
          t.variableDeclarator(node, t.numericLiteral(1)),
        ]),
      ]);
      expect(code).toContain('/** A simple description */');
      expect(code).not.toContain('*/\n');
    });

    it('sanitizes */ in single-line descriptions', () => {
      const node = t.identifier('x');
      addJSDocComment(node, [
        'Reads and enables pagination through a set of */ values.',
      ]);
      const code = generateCode([
        t.variableDeclaration('const', [
          t.variableDeclarator(node, t.numericLiteral(1)),
        ]),
      ]);
      expect(code).toContain('*\\/');
      expect(code).not.toMatch(/\/\*.*\*\/.*\*\//);
    });

    it('sanitizes */ in multi-line descriptions', () => {
      const node = t.identifier('x');
      addJSDocComment(node, [
        'First line with */ embedded',
        'Second line is fine',
        'Third line also has */ inside',
      ]);
      const code = generateCode([
        t.variableDeclaration('const', [
          t.variableDeclarator(node, t.numericLiteral(1)),
        ]),
      ]);
      const commentMatch = code.match(/\/\*[\s\S]*?\*\//);
      expect(commentMatch).not.toBeNull();
      const comment = commentMatch![0];
      const innerSlashes = comment.slice(2, -2);
      expect(innerSlashes).not.toContain('*/');
    });
  });

  describe('hooks-ast', () => {
    it('produces valid JSDoc for simple descriptions', () => {
      const node = t.identifier('y');
      addJSDocCommentHooks(node, ['A simple description']);
      expect(node.leadingComments).toHaveLength(1);
      expect(node.leadingComments![0].value).toBe('* A simple description ');
    });

    it('sanitizes */ in single-line descriptions', () => {
      const node = t.identifier('y');
      addJSDocCommentHooks(node, [
        'Reads and enables pagination through a set of */ values.',
      ]);
      expect(node.leadingComments![0].value).not.toContain('*/');
      expect(node.leadingComments![0].value).toContain('*\\/');
    });

    it('sanitizes */ in multi-line descriptions', () => {
      const node = t.identifier('y');
      addJSDocCommentHooks(node, [
        'Line with */ problem',
        'Normal line',
      ]);
      const commentValue = node.leadingComments![0].value;
      expect(commentValue).not.toContain('*/');
      expect(commentValue).toContain('*\\/');
    });
  });
});
