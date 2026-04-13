import {
  getTemplate,
  setTemplate,
  registerTenant,
  deregisterTenant,
  getTemplateStats,
  getTenantFingerprint,
  clearAllTemplates,
  sweepIdleTemplates,
  _testSetMaxTemplates,
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

  describe('sweepIdleTemplates (capacity-based / LRU eviction)', () => {
    afterEach(() => {
      _testSetMaxTemplates(undefined); // restore default
    });

    it('should evict oldest idle templates when map exceeds max-templates cap', async () => {
      const now = Date.now();
      const templates: RegistryTemplate[] = [];

      // Create 8 idle templates with default cap (50) — all within TTL
      for (let i = 0; i < 8; i++) {
        const t = makeTemplate(`fp-cap-${i}`, [`schema_${i}`]);
        t.refCount = 0;
        // Deterministic idleSince — oldest first, all within TTL (< 30 min)
        t.idleSince = now - (i + 1) * 1000; // fp-cap-0 is newest idle, fp-cap-7 is oldest idle
        setTemplate(`fp-cap-${i}`, t);
        templates.push(t);
      }

      expect(getTemplateStats().templateCount).toBe(8);

      // Now lower the cap to 5 — map has 8, which is over the new cap
      _testSetMaxTemplates(5);

      // Sweep — should evict the 3 oldest idle (8 - 5 = 3 excess)
      // Sorted by idleSince ascending: fp-cap-7 (oldest), fp-cap-6, fp-cap-5, ...
      const evicted = await sweepIdleTemplates();
      expect(evicted).toBe(3);
      expect(getTemplateStats().templateCount).toBe(5);

      // Verify LRU order: oldest idle templates evicted
      expect(getTemplate('fp-cap-7')).toBeNull(); // oldest idle — evicted
      expect(getTemplate('fp-cap-6')).toBeNull(); // second oldest — evicted
      expect(getTemplate('fp-cap-5')).toBeNull(); // third oldest — evicted
      expect(getTemplate('fp-cap-4')).not.toBeNull(); // kept
      expect(getTemplate('fp-cap-3')).not.toBeNull();
      expect(getTemplate('fp-cap-2')).not.toBeNull();
      expect(getTemplate('fp-cap-1')).not.toBeNull();
      expect(getTemplate('fp-cap-0')).not.toBeNull(); // newest idle — kept

      // Verify dispose was called on evicted templates
      expect(templates[7].pgl.release).toHaveBeenCalled();
      expect(templates[6].pgl.release).toHaveBeenCalled();
      expect(templates[5].pgl.release).toHaveBeenCalled();
      // Non-evicted templates should NOT have release called
      expect(templates[4].pgl.release).not.toHaveBeenCalled();
      expect(templates[0].pgl.release).not.toHaveBeenCalled();
    });

    it('should evict by TTL first, then by capacity (LRU) for the remainder', async () => {
      const now = Date.now();

      // Create 6 idle templates with default cap (50)
      const templates: RegistryTemplate[] = [];
      for (let i = 0; i < 6; i++) {
        const t = makeTemplate(`fp-mix-${i}`, [`mix_${i}`]);
        t.refCount = 0;
        setTemplate(`fp-mix-${i}`, t);
        templates.push(t);
      }

      // Set deterministic idleSince values
      // t0: TTL-expired
      templates[0].idleSince = now - (31 * 60 * 1000);
      // t1: oldest non-expired idle
      templates[1].idleSince = now - (20 * 60 * 1000);
      // t2: second oldest
      templates[2].idleSince = now - (15 * 60 * 1000);
      // t3: third
      templates[3].idleSince = now - (10 * 60 * 1000);
      // t4: fourth
      templates[4].idleSince = now - (5 * 60 * 1000);
      // t5: newest idle
      templates[5].idleSince = now - 1000;

      expect(getTemplateStats().templateCount).toBe(6);

      // Now lower the cap to 3
      _testSetMaxTemplates(3);

      // Phase 1: evict t0 (TTL). Remaining = 5, still > 3.
      // Phase 2: evict 2 oldest idle by LRU = t1, t2.
      const evicted = await sweepIdleTemplates();
      expect(evicted).toBe(3); // 1 TTL + 2 LRU
      expect(getTemplateStats().templateCount).toBe(3);

      expect(getTemplate('fp-mix-0')).toBeNull(); // TTL evicted
      expect(getTemplate('fp-mix-1')).toBeNull(); // LRU evicted
      expect(getTemplate('fp-mix-2')).toBeNull(); // LRU evicted
      expect(getTemplate('fp-mix-3')).not.toBeNull(); // kept
      expect(getTemplate('fp-mix-4')).not.toBeNull(); // kept
      expect(getTemplate('fp-mix-5')).not.toBeNull(); // kept
    });

    it('should not evict active templates even when over cap', async () => {
      // Create 5 templates with default cap (50)
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        const t = makeTemplate(`fp-active-${i}`, [`active_${i}`]);
        setTemplate(`fp-active-${i}`, t);

        if (i < 3) {
          // Active templates — have tenants
          registerTenant(`tenant-${i}`, `fp-active-${i}`);
        } else {
          // Idle templates within TTL
          t.idleSince = now - 1000;
        }
      }

      expect(getTemplateStats().templateCount).toBe(5);

      // Now lower cap to 3
      _testSetMaxTemplates(3);

      // Map has 5 entries, cap is 3. But only 2 are idle.
      // Phase 1: no TTL-expired.
      // Phase 2: 5 - 0 = 5 > 3, excess = 2, but only 2 idle candidates.
      // Evicts both idle templates.
      const evicted = await sweepIdleTemplates();
      expect(evicted).toBe(2);
      expect(getTemplateStats().templateCount).toBe(3);

      // Active templates remain
      expect(getTemplate('fp-active-0')).not.toBeNull();
      expect(getTemplate('fp-active-1')).not.toBeNull();
      expect(getTemplate('fp-active-2')).not.toBeNull();
      // Idle templates evicted
      expect(getTemplate('fp-active-3')).toBeNull();
      expect(getTemplate('fp-active-4')).toBeNull();
    });

    it('should not evict when at exactly the cap (not over)', async () => {
      for (let i = 0; i < 3; i++) {
        const t = makeTemplate(`fp-exact-${i}`, [`exact_${i}`]);
        t.idleSince = Date.now() - 1000; // idle but within TTL
        setTemplate(`fp-exact-${i}`, t);
      }

      // Lower cap to exactly match
      _testSetMaxTemplates(3);

      expect(getTemplateStats().templateCount).toBe(3);
      const evicted = await sweepIdleTemplates();
      expect(evicted).toBe(0);
      expect(getTemplateStats().templateCount).toBe(3);
    });

    it('should clean up tenant entries for cap-evicted templates', async () => {
      const now = Date.now();

      // Create 4 templates with default cap, each with a registered-then-deregistered tenant
      for (let i = 0; i < 4; i++) {
        const t = makeTemplate(`fp-cleanup-${i}`, [`cleanup_${i}`]);
        setTemplate(`fp-cleanup-${i}`, t);
        registerTenant(`cleanup-tenant-${i}`, `fp-cleanup-${i}`);
        deregisterTenant(`cleanup-tenant-${i}`);
        // Deterministic idle ordering
        t.idleSince = now - (4 - i) * 1000; // fp-cleanup-0 is oldest idle
      }

      expect(getTemplateStats().templateCount).toBe(4);

      // Now lower cap to 2
      _testSetMaxTemplates(2);

      // Evict 2 oldest by capacity
      const evicted = await sweepIdleTemplates();
      expect(evicted).toBe(2);

      // Tenant entries for evicted templates should be cleaned up
      expect(getTenantFingerprint('cleanup-tenant-0')).toBeNull();
      expect(getTenantFingerprint('cleanup-tenant-1')).toBeNull();
      // Remaining templates' tenant entries were already cleaned by deregister
      // (but the templates themselves remain)
      expect(getTemplate('fp-cleanup-2')).not.toBeNull();
      expect(getTemplate('fp-cleanup-3')).not.toBeNull();
    });
  });
});
