import {
  getTemplate,
  setTemplate,
  registerTenant,
  deregisterTenant,
  getTemplateStats,
  getTenantFingerprint,
  clearAllTemplates,
  sweepIdleTemplates,
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
    basePresetSnapshot: { schemas, anonRole: 'anonymous', roleName: 'authenticated' },
    createdAt: Date.now(),
    refCount: 0,
    idleSince: Date.now(),
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

    it('should clear idleSince when registering', () => {
      const template = makeTemplate('fp1');
      expect(template.idleSince).not.toBeNull();
      setTemplate('fp1', template);

      registerTenant('tenant-a', 'fp1');
      expect(template.idleSince).toBeNull();
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

    it('should set idleSince when refCount drops to 0', () => {
      const template = makeTemplate('fp1');
      setTemplate('fp1', template);

      registerTenant('tenant-a', 'fp1');
      expect(template.idleSince).toBeNull();

      deregisterTenant('tenant-a');
      expect(template.refCount).toBe(0);
      expect(template.idleSince).not.toBeNull();
      expect(typeof template.idleSince).toBe('number');
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

    it('should return accurate stats including idleSince', () => {
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

      // Both templates are active (refCount > 0), so idleSince should be null
      for (const t of stats.templates) {
        expect(t.idleSince).toBeNull();
      }
    });
  });

  describe('sweepIdleTemplates', () => {
    it('should not evict templates with active tenants', async () => {
      const template = makeTemplate('fp1');
      setTemplate('fp1', template);
      registerTenant('tenant-a', 'fp1');

      const evicted = await sweepIdleTemplates();
      expect(evicted).toBe(0);
      expect(getTemplate('fp1')).toBe(template);
    });

    it('should not evict recently-idle templates (within TTL)', async () => {
      const template = makeTemplate('fp1');
      template.idleSince = Date.now(); // Just became idle
      setTemplate('fp1', template);

      const evicted = await sweepIdleTemplates();
      expect(evicted).toBe(0);
      expect(getTemplate('fp1')).toBe(template);
    });

    it('should evict idle templates past the TTL', async () => {
      const template = makeTemplate('fp1');
      template.idleSince = Date.now() - (31 * 60 * 1000); // 31 minutes ago
      setTemplate('fp1', template);

      const evicted = await sweepIdleTemplates();
      expect(evicted).toBe(1);
      expect(getTemplate('fp1')).toBeNull();
      expect(template.pgl.release).toHaveBeenCalled();
    });

    it('should clean up tenant entries when evicting a template', async () => {
      const template = makeTemplate('fp1');
      setTemplate('fp1', template);
      registerTenant('tenant-a', 'fp1');
      deregisterTenant('tenant-a');

      // Force idle past TTL
      template.idleSince = Date.now() - (31 * 60 * 1000);

      const evicted = await sweepIdleTemplates();
      expect(evicted).toBe(1);
      expect(getTenantFingerprint('tenant-a')).toBeNull();
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
