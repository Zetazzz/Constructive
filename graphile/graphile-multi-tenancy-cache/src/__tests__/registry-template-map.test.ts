import {
  getTemplate,
  setTemplate,
  registerTenant,
  deregisterTenant,
  getTemplateStats,
  getTenantFingerprint,
  clearAllTemplates,
} from '../registry-template-map';
import type { RegistryTemplate } from '../registry-template-map';

// Mock template factory
function makeTemplate(fingerprint: string, schemas: string[] = ['test_schema']): RegistryTemplate {
  return {
    fingerprint,
    pgl: { release: jest.fn().mockResolvedValue(undefined) } as any,
    serv: {} as any,
    handler: {} as any,
    httpServer: { listening: false, close: jest.fn((cb: () => void) => cb()) } as any,
    basePresetSnapshot: {},
    createdAt: Date.now(),
    refCount: 0,
    templateSchemas: schemas,
  };
}

describe('Registry Template Map', () => {
  afterEach(async () => {
    await clearAllTemplates();
  });

  describe('getTemplate / setTemplate', () => {
    it('should return null for unknown fingerprints', () => {
      expect(getTemplate('unknown')).toBeNull();
    });

    it('should store and retrieve templates', () => {
      const template = makeTemplate('fp1');
      setTemplate('fp1', template);
      expect(getTemplate('fp1')).toBe(template);
    });

    it('should overwrite existing templates', () => {
      const t1 = makeTemplate('fp1');
      const t2 = makeTemplate('fp1');
      setTemplate('fp1', t1);
      setTemplate('fp1', t2);
      expect(getTemplate('fp1')).toBe(t2);
    });
  });

  describe('registerTenant / deregisterTenant', () => {
    it('should increment refCount when registering', () => {
      const template = makeTemplate('fp1');
      setTemplate('fp1', template);

      registerTenant('tenant-a', 'fp1');
      expect(template.refCount).toBe(1);

      registerTenant('tenant-b', 'fp1');
      expect(template.refCount).toBe(2);
    });

    it('should not double-count the same tenant', () => {
      const template = makeTemplate('fp1');
      setTemplate('fp1', template);

      registerTenant('tenant-a', 'fp1');
      registerTenant('tenant-a', 'fp1');
      expect(template.refCount).toBe(1);
    });

    it('should decrement refCount when deregistering', () => {
      const template = makeTemplate('fp1');
      setTemplate('fp1', template);

      registerTenant('tenant-a', 'fp1');
      registerTenant('tenant-b', 'fp1');
      expect(template.refCount).toBe(2);

      deregisterTenant('tenant-a');
      expect(template.refCount).toBe(1);
    });

    it('should handle deregistering unknown tenants gracefully', () => {
      expect(() => deregisterTenant('unknown')).not.toThrow();
    });

    it('should not go below zero refCount', () => {
      const template = makeTemplate('fp1');
      setTemplate('fp1', template);

      registerTenant('tenant-a', 'fp1');
      deregisterTenant('tenant-a');
      deregisterTenant('tenant-a'); // double deregister
      expect(template.refCount).toBe(0);
    });

    it('should switch fingerprints when re-registering with different fingerprint', () => {
      const t1 = makeTemplate('fp1');
      const t2 = makeTemplate('fp2');
      setTemplate('fp1', t1);
      setTemplate('fp2', t2);

      registerTenant('tenant-a', 'fp1');
      expect(t1.refCount).toBe(1);
      expect(t2.refCount).toBe(0);

      registerTenant('tenant-a', 'fp2');
      expect(t1.refCount).toBe(0);
      expect(t2.refCount).toBe(1);
    });
  });

  describe('getTenantFingerprint', () => {
    it('should return null for unknown tenants', () => {
      expect(getTenantFingerprint('unknown')).toBeNull();
    });

    it('should return the fingerprint for registered tenants', () => {
      const template = makeTemplate('fp1');
      setTemplate('fp1', template);
      registerTenant('tenant-a', 'fp1');
      expect(getTenantFingerprint('tenant-a')).toBe('fp1');
    });
  });

  describe('getTemplateStats', () => {
    it('should return empty stats when no templates exist', () => {
      const stats = getTemplateStats();
      expect(stats.templateCount).toBe(0);
      expect(stats.tenantCount).toBe(0);
      expect(stats.templates).toHaveLength(0);
    });

    it('should return accurate stats', () => {
      const t1 = makeTemplate('fp1', ['schema_a']);
      const t2 = makeTemplate('fp2', ['schema_b']);
      setTemplate('fp1', t1);
      setTemplate('fp2', t2);

      registerTenant('a1', 'fp1');
      registerTenant('a2', 'fp1');
      registerTenant('b1', 'fp2');

      const stats = getTemplateStats();
      expect(stats.templateCount).toBe(2);
      expect(stats.tenantCount).toBe(3);
      expect(stats.templates).toHaveLength(2);
    });
  });

  describe('clearAllTemplates', () => {
    it('should clear all templates and tenants', async () => {
      const t1 = makeTemplate('fp1');
      setTemplate('fp1', t1);
      registerTenant('tenant-a', 'fp1');

      await clearAllTemplates();

      expect(getTemplate('fp1')).toBeNull();
      expect(getTenantFingerprint('tenant-a')).toBeNull();
      expect(getTemplateStats().templateCount).toBe(0);
    });

    it('should call release on pgl instances', async () => {
      const t1 = makeTemplate('fp1');
      setTemplate('fp1', t1);

      await clearAllTemplates();
      expect(t1.pgl.release).toHaveBeenCalled();
    });
  });
});
