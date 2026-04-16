import {
  getTemplate,
  setTemplate,
  registerTenant,
  deregisterTenant,
  sweepIdleTemplates,
  clearAllTemplates,
  getTemplateStats,
  type RegistryTemplate,
} from '../registry-template-map';

function makeMockTemplate(fingerprint: string, overrides?: Partial<RegistryTemplate>): RegistryTemplate {
  return {
    fingerprint,
    pgl: { release: jest.fn() } as any,
    serv: {} as any,
    handler: {} as any,
    httpServer: { listening: false, close: jest.fn((cb: () => void) => cb()) } as any,
    refCount: 0,
    tenantKeys: new Set(),
    createdAt: Date.now(),
    ...overrides,
  };
}

afterEach(async () => {
  await clearAllTemplates();
});

describe('template registry', () => {
  it('stores and retrieves templates by fingerprint', () => {
    const template = makeMockTemplate('fp-abc');
    setTemplate('fp-abc', template);

    const retrieved = getTemplate('fp-abc');
    expect(retrieved).toBe(template);
  });

  it('returns undefined for missing fingerprint', () => {
    expect(getTemplate('nonexistent')).toBeUndefined();
  });

  it('registers and deregisters tenants with refCount tracking', () => {
    const template = makeMockTemplate('fp-abc');
    setTemplate('fp-abc', template);

    registerTenant('tenant-1', 'fp-abc');
    expect(template.refCount).toBe(1);
    expect(template.tenantKeys.has('tenant-1')).toBe(true);
    expect(template.idleSince).toBeUndefined();

    registerTenant('tenant-2', 'fp-abc');
    expect(template.refCount).toBe(2);

    deregisterTenant('tenant-1');
    expect(template.refCount).toBe(1);
    expect(template.idleSince).toBeUndefined();

    deregisterTenant('tenant-2');
    expect(template.refCount).toBe(0);
    expect(template.idleSince).toBeDefined();
  });

  it('does not double-count the same tenant key', () => {
    const template = makeMockTemplate('fp-abc');
    setTemplate('fp-abc', template);

    registerTenant('tenant-1', 'fp-abc');
    registerTenant('tenant-1', 'fp-abc');
    expect(template.refCount).toBe(1);
  });

  it('sweepIdleTemplates does not evict active templates', () => {
    const template = makeMockTemplate('fp-abc');
    setTemplate('fp-abc', template);
    registerTenant('tenant-1', 'fp-abc');

    sweepIdleTemplates();

    expect(getTemplate('fp-abc')).toBe(template);
  });

  it('getTemplateStats returns correct counts', () => {
    const t1 = makeMockTemplate('fp-1');
    const t2 = makeMockTemplate('fp-2');
    setTemplate('fp-1', t1);
    setTemplate('fp-2', t2);

    registerTenant('tenant-1', 'fp-1');

    const stats = getTemplateStats();
    expect(stats.size).toBe(2);
    expect(stats.activeCount).toBe(1);
    expect(stats.idleCount).toBe(1);
  });

  it('clearAllTemplates removes all templates', async () => {
    setTemplate('fp-1', makeMockTemplate('fp-1'));
    setTemplate('fp-2', makeMockTemplate('fp-2'));

    await clearAllTemplates();

    expect(getTemplate('fp-1')).toBeUndefined();
    expect(getTemplate('fp-2')).toBeUndefined();
    expect(getTemplateStats().size).toBe(0);
  });
});
